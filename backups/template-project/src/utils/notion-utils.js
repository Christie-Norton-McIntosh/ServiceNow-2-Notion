export function hyphenateNotionId(id) {
  if (!id || typeof id !== "string") return id;
  const clean = id.replace(/[^a-f0-9]/gi, "");
  if (clean.length !== 32) return id;
  return clean.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}

export function findProperty(properties, names) {
  if (!properties || !names) return null;
  for (const name of names) {
    if (properties[name]) return { id: name, ...properties[name] };
    const lower = name.toLowerCase();
    for (const [propName, propConfig] of Object.entries(properties)) {
      if (propName.toLowerCase() === lower)
        return { id: propName, ...propConfig };
    }
  }
  return null;
}
