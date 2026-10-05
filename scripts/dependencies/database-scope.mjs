const SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const relevant = (name) => name === "supabase" || name.startsWith("@supabase/");
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  return value;
};
const record = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

// Bun's text lockfile is JSON with trailing commas, not JavaScript.
export function parseLock(text) {
  return JSON.parse(
    text.replace(
      /("(?:\\.|[^"\\])*")|,\s*(?=[}\]])/g,
      (_match, string) => string ?? "",
    ),
  );
}

function declarations(manifest, names) {
  if (!record(manifest)) throw new Error("Unreadable manifest");
  const result = structuredClone(manifest);
  for (const section of [...SECTIONS, "overrides"]) {
    if (result[section] !== undefined && !record(result[section]))
      throw new Error(`Unreadable declarations: ${section}`);
    result[section] = Object.fromEntries(
      Object.entries(result[section] ?? {}).filter(
        ([name]) => relevant(name) || names.has(name),
      ),
    );
  }
  return result;
}

function graph(lock) {
  if (
    lock.lockfileVersion !== 1 ||
    !record(lock.packages) ||
    !record(lock.workspaces?.[""])
  )
    throw new Error("Unsupported Bun lockfile");
  const packages = lock.packages;
  const selected = {};
  const names = new Set();
  const visit = (key) => {
    if (Object.hasOwn(selected, key)) return;
    const entry = packages[key];
    if (
      !Array.isArray(entry) ||
      typeof entry[0] !== "string" ||
      !entry[2] ||
      typeof entry[2] !== "object"
    )
      throw new Error(`Unreadable locked package: ${key}`);
    const name = entry[0].slice(0, entry[0].lastIndexOf("@"));
    if (!name || !key.endsWith(name))
      throw new Error(`Unsupported locked alias: ${key}`);
    selected[key] = entry;
    names.add(name);
    const metadata = entry[2];
    if (!record(metadata)) throw new Error(`Unreadable metadata: ${key}`);
    for (const section of [
      "dependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      if (metadata[section] !== undefined && !record(metadata[section]))
        throw new Error(`Unreadable dependencies: ${key}`);
      for (const dependency of Object.keys(metadata[section] ?? {})) {
        // Bun nests duplicate resolutions under their parent package key.
        let parent = key;
        let resolved;
        while (parent) {
          const candidate = `${parent}/${dependency}`;
          if (Object.hasOwn(packages, candidate)) {
            resolved = candidate;
            break;
          }
          const parentEntry = packages[parent];
          const parentName = parentEntry?.[0]?.slice(
            0,
            parentEntry[0].lastIndexOf("@"),
          );
          if (!parentName || !parent.endsWith(parentName))
            throw new Error(`Unreadable package parent: ${parent}`);
          parent =
            parent === parentName
              ? ""
              : parent.slice(0, -(parentName.length + 1));
        }
        resolved ??= Object.hasOwn(packages, dependency)
          ? dependency
          : undefined;
        if (resolved) visit(resolved);
        else if (
          section === "dependencies" ||
          (section === "peerDependencies" &&
            !metadata.optionalPeers?.includes(dependency))
        )
          throw new Error(`Missing locked dependency: ${key} -> ${dependency}`);
      }
    }
  };
  for (const [key, entry] of Object.entries(packages)) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string")
      throw new Error(`Unreadable locked package: ${key}`);
    if (relevant(key) || relevant(entry[0].slice(0, entry[0].lastIndexOf("@"))))
      visit(key);
  }
  return { selected, names };
}

export function databaseDependenciesChanged(before, after) {
  const oldGraph = graph(before.lock);
  const newGraph = graph(after.lock);
  const names = new Set([...oldGraph.names, ...newGraph.names]);
  if (!equal(oldGraph.selected, newGraph.selected)) return true;
  for (const snapshot of [before, after]) {
    // Complex override selectors cannot safely be classified by package name.
    if (
      Object.keys(snapshot.manifest.overrides ?? {}).some(
        (name) => !/^(?:@[\w.-]+\/)?[\w.-]+$/.test(name),
      )
    )
      throw new Error("Unsupported override selector");
  }
  if (
    !equal(
      declarations(before.manifest, names),
      declarations(after.manifest, names),
    )
  )
    return true;
  const configuration = (lock) => {
    const copy = structuredClone(lock);
    delete copy.packages;
    copy.workspaces[""] = declarations(copy.workspaces[""], names);
    copy.overrides = declarations(
      { overrides: copy.overrides },
      names,
    ).overrides;
    return copy;
  };
  return !equal(configuration(before.lock), configuration(after.lock));
}
