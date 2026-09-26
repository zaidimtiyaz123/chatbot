/**
 * Real-time Web Search and Live Data Provider
 * Fetches up-to-the-minute web information from multiple reliable sources:
 * 1. Google News RSS (breaking news, current events, sports, tech, politics)
 * 2. Wikipedia Search API (encyclopedic, biographical, historical, tournament records)
 * 3. DuckDuckGo Instant Answers (entity definitions, topics, official sites)
 * 4. CoinGecko API (live real-time crypto prices, 24h market stats)
 * 5. Open-Meteo Geocoding & Weather (live real-time temperature, weather conditions)
 */

export interface LiveSearchResult {
  context: string;
  sources: Array<{ title: string; uri: string }>;
  searchQueries: string[];
}

export const LiveSearchResult = {} as any;

function cleanText(text: string): string {
  return text
    .replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract weather query keywords like "weather in Tokyo" or "temperature in London"
 */
function extractCityForWeather(query: string): string | null {
  const q = query.toLowerCase();
  if (q.includes("weather") || q.includes("temperature") || q.includes("forecast")) {
    const match = query.match(/(?:weather|temperature|forecast)(?:\s+(?:in|for|at))?\s+([A-Za-z\s]+)/i);
    if (match && match[1]) {
      const city = match[1].replace(/today|tomorrow|now|currently|this week|\?/gi, "").trim();
      if (city.length >= 2 && city.length <= 40) return city;
    }
  }
  return null;
}

/**
 * Check if query asks for crypto prices
 */
function isCryptoQuery(query: string): boolean {
  const q = query.toLowerCase();
  return (
    q.includes("bitcoin") ||
    q.includes("btc") ||
    q.includes("ethereum") ||
    q.includes("eth") ||
    q.includes("solana") ||
    q.includes("sol") ||
    q.includes("crypto") ||
    q.includes("dogecoin")
  );
}

export async function searchLiveWeb(query: string): Promise<LiveSearchResult> {
  const sources: Array<{ title: string; uri: string }> = [];
  const searchQueries: string[] = [query];
  const contextSections: string[] = [];

  // Helper to safely add sources without duplicates
  const seenUrls = new Set<string>();
  const addSource = (title: string, uri: string) => {
    if (!uri || seenUrls.has(uri)) return;
    seenUrls.add(uri);
    sources.push({ title, uri });
  };

  const tasks: Promise<void>[] = [];

  // 1. Live Crypto Check
  if (isCryptoQuery(query)) {
    tasks.push(
      (async () => {
        try {
          const res = await fetch(
            "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,cardano,ripple,dogecoin&vs_currencies=usd&include_24hr_change=true",
            { signal: AbortSignal.timeout(3500) }
          );
          if (res.ok) {
            const data = await res.json();
            const btc = data.bitcoin ? `$${data.bitcoin.usd} (${data.bitcoin.usd_24h_change?.toFixed(2)}% 24h)` : "N/A";
            const eth = data.ethereum ? `$${data.ethereum.usd} (${data.ethereum.usd_24h_change?.toFixed(2)}% 24h)` : "N/A";
            const sol = data.solana ? `$${data.solana.usd} (${data.solana.usd_24h_change?.toFixed(2)}% 24h)` : "N/A";

            contextSections.push(
              `[LIVE CRYPTO MARKET PRICES - CoinGecko]\n` +
              `- Bitcoin (BTC): ${btc}\n` +
              `- Ethereum (ETH): ${eth}\n` +
              `- Solana (SOL): ${sol}\n`
            );
            addSource("CoinGecko Live Crypto Market", "https://www.coingecko.com");
            searchQueries.push("CoinGecko Live Rates");
          }
        } catch {
          // ignore error
        }
      })()
    );
  }

  // 2. Live Weather Check
  const city = extractCityForWeather(query);
  if (city) {
    tasks.push(
      (async () => {
        try {
          const geoRes = await fetch(
            `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`,
            { signal: AbortSignal.timeout(3500) }
          );
          if (geoRes.ok) {
            const geoData = await geoRes.json();
            const loc = geoData.results?.[0];
            if (loc) {
              const weatherRes = await fetch(
                `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current_weather=true`,
                { signal: AbortSignal.timeout(3500) }
              );
              if (weatherRes.ok) {
                const wData = await weatherRes.json();
                const cw = wData.current_weather;
                if (cw) {
                  contextSections.push(
                    `[LIVE WEATHER DATA - Open-Meteo]\n` +
                    `Location: ${loc.name}, ${loc.country || ""}\n` +
                    `Temperature: ${cw.temperature}°C (${((cw.temperature * 9) / 5 + 32).toFixed(1)}°F)\n` +
                    `Wind Speed: ${cw.windspeed} km/h\n` +
                    `Timestamp: ${cw.time}\n`
                  );
                  addSource(`Open-Meteo Weather for ${loc.name}`, `https://open-meteo.com`);
                  searchQueries.push(`Weather in ${loc.name}`);
                }
              }
            }
          }
        } catch {
          // ignore error
        }
      })()
    );
  }

  // 3. Google News RSS Search
  tasks.push(
    (async () => {
      try {
        const qEnc = encodeURIComponent(query);
        const res = await fetch(
          `https://news.google.com/rss/search?q=${qEnc}&hl=en-US&gl=US&ceid=US:en`,
          {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
            signal: AbortSignal.timeout(4500),
          }
        );

        if (res.ok) {
          const xml = await res.text();
          const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 6);
          const newsSnippets: string[] = [];

          for (const item of items) {
            const content = item[1];
            const titleMatch = content.match(/<title>([\s\S]*?)<\/title>/);
            const linkMatch = content.match(/<link>([\s\S]*?)<\/link>/);
            const sourceMatch = content.match(/<source[^>]*>([\s\S]*?)<\/source>/);
            const pubDateMatch = content.match(/<pubDate>([\s\S]*?)<\/pubDate>/);

            if (titleMatch && linkMatch) {
              const rawTitle = cleanText(titleMatch[1]);
              const sourceName = sourceMatch ? cleanText(sourceMatch[1]) : "Verified News";
              const uri = linkMatch[1].trim();
              const pubDate = pubDateMatch ? pubDateMatch[1].trim() : "";

              newsSnippets.push(`- Title: ${rawTitle}\n  Source: ${sourceName} | Date: ${pubDate}\n  Link: ${uri}`);
              addSource(`${rawTitle} (${sourceName})`, uri);
            }
          }

          if (newsSnippets.length > 0) {
            contextSections.push(`[REAL-TIME NEWS & MEDIA COVERAGE]\n${newsSnippets.join("\n\n")}`);
            searchQueries.push("Google News Live Articles");
          }
        }
      } catch {
        // ignore error
      }
    })()
  );

  // 4. Wikipedia Search API
  tasks.push(
    (async () => {
      try {
        const qEnc = encodeURIComponent(query);
        const res = await fetch(
          `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${qEnc}&utf8=&format=json&origin=*`,
          { signal: AbortSignal.timeout(4000) }
        );

        if (res.ok) {
          const data = await res.json();
          const wikiItems = (data?.query?.search || []).slice(0, 3);
          const wikiSnippets: string[] = [];

          for (const w of wikiItems) {
            const snippet = cleanText(w.snippet);
            const uri = `https://en.wikipedia.org/wiki/${encodeURIComponent(w.title.replace(/ /g, "_"))}`;
            wikiSnippets.push(`- Topic: ${w.title}\n  Summary: ${snippet}\n  Link: ${uri}`);
            addSource(`${w.title} - Wikipedia`, uri);
          }

          if (wikiSnippets.length > 0) {
            contextSections.push(`[WIKIPEDIA FACTUAL GROUNDING]\n${wikiSnippets.join("\n\n")}`);
            searchQueries.push("Wikipedia Knowledge Base");
          }
        }
      } catch {
        // ignore error
      }
    })()
  );

  // 5. DuckDuckGo Instant Answer API & Related Web Topics
  tasks.push(
    (async () => {
      try {
        const qEnc = encodeURIComponent(query);
        const res = await fetch(`https://api.duckduckgo.com/?q=${qEnc}&format=json`, {
          signal: AbortSignal.timeout(3500),
        });

        if (res.ok) {
          const data = await res.json();
          const ddgSnippets: string[] = [];

          if (data.AbstractText) {
            const abstract = cleanText(data.AbstractText);
            const uri = data.AbstractURL || "https://duckduckgo.com";
            ddgSnippets.push(`Heading: ${data.Heading || query}\nAbstract: ${abstract}\nLink: ${uri}`);
            addSource(data.Heading || "DuckDuckGo Instant Overview", uri);
          }

          if (Array.isArray(data.RelatedTopics)) {
            for (const item of data.RelatedTopics) {
              if (item.Text && item.FirstURL) {
                const text = cleanText(item.Text);
                const uri = item.FirstURL;
                ddgSnippets.push(`Topic: ${text}\nLink: ${uri}`);
                const shortTitle = text.slice(0, 70);
                addSource(shortTitle, uri);
              } else if (Array.isArray(item.Topics)) {
                for (const sub of item.Topics) {
                  if (sub.Text && sub.FirstURL) {
                    const text = cleanText(sub.Text);
                    const uri = sub.FirstURL;
                    ddgSnippets.push(`Topic: ${text}\nLink: ${uri}`);
                    addSource(text.slice(0, 70), uri);
                  }
                }
              }
              if (ddgSnippets.length >= 4) break;
            }
          }

          if (ddgSnippets.length > 0) {
            contextSections.push(`[DUCKDUCKGO WEB KNOWLEDGE]\n${ddgSnippets.join("\n\n")}`);
            searchQueries.push("DuckDuckGo Web Knowledge");
          }
        }
      } catch {
        // ignore error
      }
    })()
  );

  // Wait for all searches to complete or timeout
  await Promise.allSettled(tasks);

  const context = contextSections.join("\n\n---\n\n");

  return {
    context,
    sources: sources.slice(0, 8),
    searchQueries: Array.from(new Set(searchQueries)),
  };
}
