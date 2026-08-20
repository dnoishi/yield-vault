import { afterEach, describe, expect, it, vi } from "vitest";
import { loadDreamDexMarketData } from "./dreamdex";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadDreamDexMarketData", () => {
  it("keeps recent API trades when volume fails", async () => {
    const trade = {
      id: "bid:ask",
      timestamp: 1_787_233_480_735,
      side: "sell",
      price: "2272.3",
      amount: "0.02",
      cost: "45.446",
    };
    stubDreamDexApi({ trades: [trade], failVolume: true });

    const result = await loadDreamDexMarketData(
      "/api/dreamdex",
      "WETH:USDso",
    );

    expect(result.trades).toEqual([trade]);
    expect(result.tradesAvailable).toBe(true);
    expect(result.mid).toBe(2273);
    expect(result.quoteVolume).toBe(0);
  });

  it("defaults a missing trades array to an empty tape", async () => {
    stubDreamDexApi({});

    const result = await loadDreamDexMarketData(
      "/api/dreamdex",
      "WETH:USDso",
    );

    expect(result.trades).toEqual([]);
    expect(result.tradesAvailable).toBe(true);
  });
});

function stubDreamDexApi({
  trades,
  failVolume = false,
}: {
  trades?: unknown[];
  failVolume?: boolean;
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/volume")) {
        return failVolume
          ? new Response("unavailable", { status: 503 })
          : Response.json({ quoteVolume: "778", until: 456 });
      }
      if (url.includes("/trades?")) {
        return Response.json(
          trades === undefined
            ? { symbol: "WETH:USDso" }
            : { symbol: "WETH:USDso", trades },
        );
      }
      if (url.endsWith("/markets")) {
        return Response.json({
          markets: [
            {
              symbol: "WETH:USDso",
              contract: "0x1111111111111111111111111111111111111111",
            },
          ],
        });
      }
      if (url.includes("/orderbooks?")) {
        return Response.json({
          orderbooks: [
            {
              bids: [{ price: "2272", quantity: "1" }],
              asks: [{ price: "2274", quantity: "1" }],
              timestamp: 123,
            },
          ],
        });
      }
      return Response.json({
        symbols: [
          {
            open: "2200",
            close: "2273",
            volume: "0.5",
            lastTradeAt: 1_787_233_480_735,
          },
        ],
      });
    }),
  );
}
