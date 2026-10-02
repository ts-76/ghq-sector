import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  symlink,
  unlink,
} from "node:fs/promises";
import path from "node:path";

export interface ManagedLink {
  destinationPath: string;
  sourcePath: string;
}

export class WorkspaceSyncConflictError extends Error {
  readonly code = "WORKSPACE_SYNC_CONFLICT";
  constructor(readonly conflicts: { path: string; reason: string }[]) {
    super(
      `Workspace sync refused:\n${conflicts.map((entry) => `- ${entry.path}: ${entry.reason}`).join("\n")}`,
    );
    this.name = "WorkspaceSyncConflictError";
  }
}

function conflict(entryPath: string, reason: string): never {
  throw new WorkspaceSyncConflictError([{ path: entryPath, reason }]);
}

export async function statIfPresent(entryPath: string) {
  try {
    return await lstat(entryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

// Reject all symlink parents below the chosen root, including aliases within it.
// Require an actual root directory too; callers can choose its canonical path.
export async function assertSafePath(root: string, destination: string) {
  const resolvedRoot = path.resolve(root);
  await assertDirectory(resolvedRoot, resolvedRoot);
  const relative = path.relative(resolvedRoot, path.resolve(destination));
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    conflict(destination, "destination must be strictly inside workspace root");
  }
  let parent = resolvedRoot;
  for (const segment of relative.split(path.sep).slice(0, -1)) {
    parent = path.join(parent, segment);
    const stat = await statIfPresent(parent);
    if (stat && !stat.isDirectory()) {
      conflict(
        parent,
        stat.isSymbolicLink()
          ? "symlink parent is not allowed"
          : "parent is not a directory",
      );
    }
  }
}

export async function assertDirectory(root: string, directory: string) {
  if (path.resolve(directory) !== path.resolve(root))
    await assertSafePath(root, directory);
  const stat = await statIfPresent(directory);
  if (stat && !stat.isDirectory())
    conflict(directory, "expected an actual directory");
}

export async function assertMetadataFile(root: string, filename: string) {
  await assertSafePath(root, filename);
  const stat = await statIfPresent(filename);
  if (stat && !stat.isFile())
    conflict(filename, "metadata must be an actual file");
}

export async function usesCaseInsensitivePaths(root: string) {
  let ancestor = path.resolve(root);
  while (!(await statIfPresent(ancestor))) ancestor = path.dirname(ancestor);
  while (ancestor !== path.dirname(ancestor)) {
    const basename = path.basename(ancestor);
    const alternate = basename.replace(/[a-zA-Z]/, (letter) =>
      letter === letter.toUpperCase()
        ? letter.toLowerCase()
        : letter.toUpperCase(),
    );
    if (alternate !== basename) {
      const original = await statIfPresent(ancestor);
      const changed = await statIfPresent(
        path.join(path.dirname(ancestor), alternate),
      );
      return (
        !!changed &&
        original?.ino === changed.ino &&
        original?.dev === changed.dev
      );
    }
    ancestor = path.dirname(ancestor);
  }
  return false;
}

function destinationKey(destination: string, caseInsensitive: boolean) {
  const resolved = path.resolve(destination);
  return caseInsensitive ? resolved.normalize("NFD").toLowerCase() : resolved;
}

export function assertDistinctLinks(
  links: ManagedLink[],
  caseInsensitive = false,
) {
  const paths = links.map((link) =>
    destinationKey(link.destinationPath, caseInsensitive),
  );
  for (let index = 0; index < paths.length; index++) {
    const destination = paths[index];
    if (!destination) continue;
    for (const other of paths.slice(index + 1)) {
      if (
        destination === other ||
        destination.startsWith(`${other}${path.sep}`) ||
        other.startsWith(`${destination}${path.sep}`)
      ) {
        conflict(destination, `duplicate or overlapping destination: ${other}`);
      }
    }
  }
}

export function assertLinkDirectories(
  links: ManagedLink[],
  directories: string[],
  caseInsensitive = false,
) {
  for (const link of links) {
    const destination = destinationKey(link.destinationPath, caseInsensitive);
    for (const directory of directories.map((entry) =>
      destinationKey(entry, caseInsensitive),
    )) {
      if (
        destination === directory ||
        directory.startsWith(`${destination}${path.sep}`)
      ) {
        conflict(
          destination,
          `link overlaps a required directory: ${directory}`,
        );
      }
    }
  }
}

export async function readLinkManifest(
  filename: string,
): Promise<ManagedLink[]> {
  try {
    const data = JSON.parse(await readFile(filename, "utf8"));
    // Legacy arrays only recorded paths: they cannot establish link ownership.
    if (data?.version !== 1 || !Array.isArray(data.links)) return [];
    return data.links.filter(
      (entry: ManagedLink) =>
        typeof entry?.destinationPath === "string" &&
        typeof entry?.sourcePath === "string",
    );
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT" ||
      error instanceof SyntaxError
    )
      return [];
    throw error;
  }
}

export async function assertLink(
  root: string,
  link: ManagedLink,
  previous: ManagedLink[],
) {
  await assertSafePath(root, link.destinationPath);
  const stat = await statIfPresent(link.destinationPath);
  if (!stat) return;
  if (!stat.isSymbolicLink())
    conflict(
      link.destinationPath,
      stat.isDirectory()
        ? "existing directory is preserved"
        : "existing file is preserved",
    );
  const target = path.resolve(
    path.dirname(link.destinationPath),
    await readlink(link.destinationPath),
  );
  if (target === path.resolve(link.sourcePath)) return;
  if (
    !previous.some(
      (entry) =>
        path.resolve(entry.destinationPath) ===
          path.resolve(link.destinationPath) &&
        path.resolve(entry.sourcePath) === target,
    )
  ) {
    conflict(link.destinationPath, "unexpected symlink target is preserved");
  }
}

export async function installLink(
  root: string,
  link: ManagedLink,
  previous: ManagedLink[],
) {
  // Recheck immediately before unlink; never use recursive removal on a link.
  await assertLink(root, link, previous);
  await mkdir(path.dirname(link.destinationPath), { recursive: true });
  const stat = await statIfPresent(link.destinationPath);
  if (stat) {
    await assertLink(root, link, previous);
    const target = path.resolve(
      path.dirname(link.destinationPath),
      await readlink(link.destinationPath),
    );
    if (target === path.resolve(link.sourcePath)) return;
    await unlink(link.destinationPath);
  }
  await symlink(link.sourcePath, link.destinationPath, "dir");
}

export async function removeRecordedLink(root: string, link: ManagedLink) {
  await assertSafePath(root, link.destinationPath);
  const stat = await statIfPresent(link.destinationPath);
  if (!stat?.isSymbolicLink()) return false;
  const target = path.resolve(
    path.dirname(link.destinationPath),
    await readlink(link.destinationPath),
  );
  if (target !== path.resolve(link.sourcePath)) return false;
  await unlink(link.destinationPath);
  return true;
}

export async function writeLinkManifest(
  root: string,
  filename: string,
  links: ManagedLink[],
) {
  await writeMetadataFile(
    root,
    filename,
    `${JSON.stringify({ version: 1, links }, null, 2)}\n`,
  );
}

export async function writeMetadataFile(
  root: string,
  filename: string,
  contents: string,
) {
  await assertMetadataFile(root, filename);
  await mkdir(path.dirname(filename), { recursive: true });
  await assertMetadataFile(root, filename);
  const file = await open(
    filename,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_TRUNC |
      constants.O_NOFOLLOW,
  );
  try {
    await file.writeFile(contents, "utf8");
  } finally {
    await file.close();
  }
}
