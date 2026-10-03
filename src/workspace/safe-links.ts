import { constants } from "node:fs";
import {
  link as hardlink,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readlink,
  rename,
  rmdir,
  symlink,
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
  // Probe a child of the target directory, not its basename in the parent
  // volume: a workspace may itself be a mount point with different behavior.
  const probe = await mkdtemp(path.join(ancestor, ".ghq-sector-case-"));
  try {
    const original = await lstat(probe);
    const changed = await statIfPresent(
      path.join(ancestor, path.basename(probe).toUpperCase()),
    );
    return (
      !!changed && original.ino === changed.ino && original.dev === changed.dev
    );
  } finally {
    await rmdir(probe);
  }
}

// mkdir is an exclusive cross-process lease shared by CLI and editor Sync.
// A crash leaves the empty lease for manual inspection; never steal a lease.
export async function withWorkspaceSyncLease<T>(
  root: string,
  action: () => Promise<T>,
): Promise<T> {
  await assertDirectory(root, root);
  await mkdir(root, { recursive: true });
  const lease = path.join(root, ".ghq-sector-sync.lock");
  try {
    await mkdir(lease, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      conflict(
        lease,
        "another sync holds the workspace lease; inspect a leftover lease before removing it",
      );
    throw error;
  }
  try {
    return await action();
  } finally {
    // rmdir refuses files and nonempty directories: never recursively clean.
    await rmdir(lease);
  }
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
    await retireLink(root, { ...link, sourcePath: target });
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
  await retireLink(root, link);
  return true;
}

async function retireLink(root: string, link: ManagedLink) {
  await assertSafePath(root, link.destinationPath);
  // Atomically move the entry before inspecting it. Checking then unlinking the
  // original pathname could delete a real file swapped in by an external writer.
  // Keep the displaced entry as recovery data: never unlink it after a check.
  const recovery = await mkdtemp(
    path.join(path.dirname(link.destinationPath), ".ghq-sector-retired-"),
  );
  const retained = path.join(recovery, "entry");
  try {
    await assertSafePath(root, link.destinationPath);
    await rename(link.destinationPath, retained);
  } catch (error) {
    await rmdir(recovery);
    throw error;
  }
  const stat = await lstat(retained);
  const target = stat.isSymbolicLink()
    ? path.resolve(path.dirname(link.destinationPath), await readlink(retained))
    : null;
  if (target === path.resolve(link.sourcePath)) return;

  // Restore access without ever overwriting an entry created by another writer.
  // Files/symlinks use an exclusive hardlink; directories use a recovery symlink.
  // The retained entry survives either outcome for manual recovery.
  let restored = false;
  try {
    await assertSafePath(root, link.destinationPath);
    if (stat.isDirectory())
      await symlink(retained, link.destinationPath, "dir");
    else await hardlink(retained, link.destinationPath);
    restored = true;
  } catch {
    // EEXIST or a changed parent must not replace the new destination.
  }
  conflict(
    link.destinationPath,
    `entry changed during sync and was preserved at ${retained}${restored ? "; access restored at the destination" : "; destination left untouched"}`,
  );
}

export async function observedOwnedLinks(
  root: string,
  desired: ManagedLink[],
  previous: ManagedLink[],
) {
  const observed: ManagedLink[] = [];
  for (const link of desired) {
    await assertLink(root, link, previous);
    const stat = await statIfPresent(link.destinationPath);
    if (!stat?.isSymbolicLink()) continue;
    const sourcePath = path.resolve(
      path.dirname(link.destinationPath),
      await readlink(link.destinationPath),
    );
    if (
      sourcePath !== path.resolve(link.sourcePath) &&
      !previous.some(
        (entry) =>
          path.resolve(entry.destinationPath) ===
            path.resolve(link.destinationPath) &&
          path.resolve(entry.sourcePath) === sourcePath,
      )
    ) {
      conflict(link.destinationPath, "unexpected symlink target is preserved");
    }
    observed.push({
      destinationPath: link.destinationPath,
      sourcePath,
    });
  }
  return observed;
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
