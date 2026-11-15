import { describe, expect, it } from "vitest";
import { runOrdered } from "@/features/activity/export/orderedPool";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("runOrdered", () => {
  it("hands the results over in order even when later frames finish first", async () => {
    const seen: number[] = [];
    await runOrdered({
      count: 12,
      workers: 4,
      lookahead: 8,
      // Early frames are the slow ones.
      produce: async (index) => {
        await sleep((12 - index) * 2);
        return index * 10;
      },
      consume: async (index, value) => {
        expect(value).toBe(index * 10);
        seen.push(index);
      },
    });
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("never has more frames in the making than there are workers", async () => {
    let active = 0;
    let peak = 0;
    const busy = new Set<number>();
    await runOrdered({
      count: 20,
      workers: 3,
      lookahead: 6,
      produce: async (_index, worker) => {
        expect(busy.has(worker)).toBe(false);
        busy.add(worker);
        active += 1;
        peak = Math.max(peak, active);
        await sleep(3);
        active -= 1;
        busy.delete(worker);
        return 0;
      },
      consume: async () => undefined,
    });
    expect(peak).toBe(3);
  });

  it("does not run further ahead of the consumer than the lookahead", async () => {
    let consumed = 0;
    let furthest = 0;
    await runOrdered({
      count: 30,
      workers: 4,
      lookahead: 5,
      produce: async (index) => {
        furthest = Math.max(furthest, index - consumed);
        return index;
      },
      consume: async () => {
        await sleep(2);
        consumed += 1;
      },
    });
    expect(furthest).toBeLessThanOrEqual(5);
  });

  it("is faster than one worker when the work is waiting", async () => {
    const run = async (workers: number) => {
      const start = performance.now();
      await runOrdered({
        count: 16,
        workers,
        lookahead: 16,
        produce: async () => {
          await sleep(10);
          return 0;
        },
        consume: async () => undefined,
      });
      return performance.now() - start;
    };
    const one = await run(1);
    const four = await run(4);
    expect(four).toBeLessThan(one * 0.6);
  });

  it("stops and reports the error when a frame fails", async () => {
    const seen: number[] = [];
    await expect(
      runOrdered({
        count: 10,
        workers: 3,
        lookahead: 6,
        produce: async (index) => {
          await sleep(2);
          if (index === 4) throw new Error("tile never came");
          return index;
        },
        consume: async (index) => {
          seen.push(index);
        },
      }),
    ).rejects.toThrow("tile never came");
    expect(seen.every((index) => index < 4)).toBe(true);
  });

  it("stops when aborted", async () => {
    const controller = new AbortController();
    let made = 0;
    const promise = runOrdered({
      count: 1000,
      workers: 2,
      lookahead: 4,
      produce: async (index) => {
        made += 1;
        if (index === 10) controller.abort();
        await sleep(1);
        return index;
      },
      consume: async () => undefined,
      signal: controller.signal,
    });
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(made).toBeLessThan(40);
  });

  it("gives a worker consecutive frames when asked for blocks, and still hands over in order", async () => {
    const made: Record<number, number[]> = {};
    const seen: number[] = [];
    await runOrdered({
      count: 40,
      workers: 3,
      block: 8,
      lookahead: 24,
      produce: async (index, worker) => {
        (made[worker] ??= []).push(index);
        await sleep(1 + (index % 3));
        return index;
      },
      consume: async (index) => {
        seen.push(index);
      },
    });
    expect(seen).toEqual(Array.from({ length: 40 }, (_, i) => i));
    for (const frames of Object.values(made)) {
      // Within a block a map's frames follow one another.
      for (let k = 1; k < frames.length; k++) {
        const prev = frames[k - 1] as number;
        const here = frames[k] as number;
        if (here % 8 !== 0) expect(here).toBe(prev + 1);
      }
    }
  });

  it("copes with no frames at all", async () => {
    await runOrdered({
      count: 0,
      workers: 3,
      lookahead: 3,
      produce: async () => 0,
      consume: async () => undefined,
    });
  });
});
