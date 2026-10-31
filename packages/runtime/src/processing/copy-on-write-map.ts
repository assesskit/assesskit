/**
 * A map that is the map it starts from until its first write, and then a copy of it, so that reading it and passing it on
 * unchanged cost nothing.
 *
 * @remarks
 * {@link CopyOnWriteMap.snapshot} hands out the map as it is; a write after that copies it again, so that a map handed
 * out never changes.
 */
export class CopyOnWriteMap<T> {
  private readable: ReadonlyMap<string, T>;
  private writable: Map<string, T> | undefined;

  constructor(start: ReadonlyMap<string, T>) {
    this.readable = start;
  }

  get(key: string): T | undefined {
    return (this.writable ?? this.readable).get(key);
  }

  set(key: string, value: T): void {
    this.writable ??= new Map(this.readable);
    this.writable.set(key, value);
  }

  /** Returns the map as it is now. */
  snapshot(): ReadonlyMap<string, T> {
    if (this.writable !== undefined) {
      this.readable = this.writable;
      this.writable = undefined;
    }
    return this.readable;
  }
}
