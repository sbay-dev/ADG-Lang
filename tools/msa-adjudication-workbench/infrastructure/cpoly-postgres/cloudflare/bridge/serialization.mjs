const INTEGER_OIDS = new Set([20, 21, 23, 26]);

export function serializeRows(result) {
  const columnTypes = new Map(
    (Array.isArray(result?.columns) ? result.columns : [])
      .map(column => [String(column.name), Number(column.type)])
  );
  return Array.from(result, row => serializeRow(row, columnTypes));
}

export function serializeRow(row, columnTypes = new Map()) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    serializeValue(value, columnTypes.get(key))
  ]));
}

function serializeValue(value, oid) {
  if (INTEGER_OIDS.has(Number(oid))) {
    return serializeInteger(value);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("base64");
  }
  return value;
}

function serializeInteger(value) {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value !== "bigint"
      && (typeof value !== "string" || !/^-?\d+$/u.test(value))) {
    return value;
  }
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : value.toString();
}
