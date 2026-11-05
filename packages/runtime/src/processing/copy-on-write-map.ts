import type { Value } from "../values/index.js";

/**
 * A map of variables that is the map it starts from until its first write, and then a copy of it, so that reading it and
 * passing it on unchanged cost nothing.
 *
 * @remarks
 * {@link CopyOnWriteMap.snapshot} hands out the map as it is; a write after that copies it again, so that a map handed
 * out never changes.
 */
export class CopyOnWriteMap {
  private readable: ReadonlyMap<string, Value | null>;
  private writable: Map<string, Value | null> | undefined;

  constructor(start: ReadonlyMap<string, Value | null>) {
    this.readable = start;
  }

  get(key: string): Value | null | undefined {
    return (this.writable ?? this.readable).get(key);
  }

  set(key: string, value: Value | null): void {
    this.writable ??= new Map(this.readable);
    this.writable.set(key, value);
  }

  /** Returns the map as it is now. */
  snapshot(): ReadonlyMap<string, Value | null> {
    if (this.writable !== undefined) {
      this.readable = this.writable;
      this.writable = undefined;
    }
    return this.readable;
  }
}
