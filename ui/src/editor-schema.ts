import type { JsonSchema, JsonValue } from "@visual-json/core";

// Suggestions remain examples for free-form hosts/categories. Only the real
// closed agent provider set is an enum, matching the CLI's validation schema.
export function withDraftChoices(
  base: JsonSchema | null,
  draft: JsonValue,
): JsonSchema | null {
  if (!base) return null;
  const schema = JSON.parse(JSON.stringify(base)) as JsonSchema;
  const config =
    draft && typeof draft === "object" && !Array.isArray(draft) ? draft : {};
  const categories = Array.isArray(config.categories)
    ? [
        ...new Set(
          config.categories.filter(
            (item): item is string =>
              typeof item === "string" && item.length > 0,
          ),
        ),
      ]
    : [];
  const defaults =
    config.defaults &&
    typeof config.defaults === "object" &&
    !Array.isArray(config.defaults)
      ? config.defaults
      : {};
  const repos = Array.isArray(config.repos) ? config.repos : [];
  const providers = new Set(["github.com", "gitlab.com", "bitbucket.org"]);
  if (typeof defaults.provider === "string" && defaults.provider)
    providers.add(defaults.provider);
  for (const repo of repos) {
    if (
      repo &&
      typeof repo === "object" &&
      !Array.isArray(repo) &&
      typeof repo.provider === "string" &&
      repo.provider
    ) {
      providers.add(repo.provider);
    }
  }
  const defaultsSchema = schema.properties?.defaults?.properties;
  const repoItems = schema.properties?.repos?.items;
  const repoSchema =
    repoItems && !Array.isArray(repoItems) ? repoItems.properties : undefined;
  for (const properties of [defaultsSchema, repoSchema]) {
    if (properties?.provider) {
      properties.provider.examples = [...providers];
      delete properties.provider.enum;
    }
    if (properties?.category) {
      properties.category.examples = categories;
      delete properties.category.enum;
    }
  }
  return schema;
}
