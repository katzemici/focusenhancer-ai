import { describe, expect, it } from "vitest";
import { MAX_QUALITY, MIN_QUALITY, outputSize, searchQuality, sliderFromTarget, targetFromSlider } from "./compress";

/** Fake encoder: size grows monotonically with quality, like JPEG. */
const fake = (bytesAt: (q: number) => number) => {
  const calls: number[] = [];
  const encode = async (q: number) => {
    calls.push(q);
    return new Blob([new Uint8Array(Math.round(bytesAt(q)))]);
  };
  return { encode, calls };
};

describe("compressor", () => {
  it("finds the highest quality under the target", async () => {
    const { encode } = fake((q) => 100_000 + 900_000 * q * q);
    const r = await searchQuality(encode, 400_000);
    expect(r.metTarget).toBe(true);
    expect(r.blob.size).toBeLessThanOrEqual(400_000);
    // Analytical answer: q = sqrt(300k/900k) ≈ 0.577
    expect(r.quality).toBeGreaterThan(0.55);
    expect(r.quality).toBeLessThan(0.58);
  });

  it("returns max quality when it already fits", async () => {
    const { encode, calls } = fake(() => 1000);
    const r = await searchQuality(encode, 5000);
    expect(r.quality).toBe(MAX_QUALITY);
    expect(calls.length).toBe(1);
  });

  it("reports when the target is unreachable", async () => {
    const { encode } = fake((q) => 1_000_000 + q);
    const r = await searchQuality(encode, 10);
    expect(r.metTarget).toBe(false);
    expect(r.quality).toBe(MIN_QUALITY);
  });

  it("resizes to the longest edge and keeps aspect", () => {
    expect(outputSize(6000, 4000, 1920)).toEqual({ width: 1920, height: 1280 });
    expect(outputSize(1000, 3000, 1500)).toEqual({ width: 500, height: 1500 });
    expect(outputSize(800, 600, 1920)).toEqual({ width: 800, height: 600 });
    expect(outputSize(800, 600, null)).toEqual({ width: 800, height: 600 });
  });

  it("target slider mapping round-trips", () => {
    for (const v of [0, 25, 50, 100]) expect(sliderFromTarget(targetFromSlider(v))).toBeCloseTo(v, 1);
    expect(targetFromSlider(0)).toBe(50 * 1024);
  });
});
