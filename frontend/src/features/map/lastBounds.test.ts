import { describe, expect, it } from "vitest";
import { parseBounds, readLastBounds, rememberBounds } from "@/features/map/lastBounds";
import type { MapBounds } from "@/map/types";

class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

const doha: MapBounds = [
  [51.4, 25.2],
  [51.6, 25.4],
];

describe("last bounds", () => {
  it("round-trips through storage", () => {
    const storage = new MemoryStorage();
    expect(readLastBounds(storage)).toBeNull();
    rememberBounds(doha, storage);
    expect(readLastBounds(storage)).toEqual(doha);
  });

  it("is null for junk, and for a storage that throws", () => {
    const storage = new MemoryStorage();
    storage.setItem("ga.map.lastBounds", "{not json");
    expect(readLastBounds(storage)).toBeNull();
    const refusing = new MemoryStorage();
    refusing.getItem = () => {
      throw new Error("denied");
    };
    expect(readLastBounds(refusing)).toBeNull();
    expect(() => rememberBounds(doha, refusing)).not.toThrow();
  });

  it("accepts only a sane box", () => {
    expect(parseBounds(doha)).toEqual(doha);
    expect(
      parseBounds([
        [51.6, 25.2],
        [51.4, 25.4],
      ]),
    ).toBeNull(); // west of east
    expect(
      parseBounds([
        [51.4, 95],
        [51.6, 96],
      ]),
    ).toBeNull(); // past the pole
    expect(parseBounds([[51.4, 25.2]])).toBeNull();
    expect(
      parseBounds([
        ["51", 25],
        [52, 26],
      ]),
    ).toBeNull();
    expect(parseBounds(null)).toBeNull();
  });
});
