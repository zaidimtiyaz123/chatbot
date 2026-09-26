export interface ClientSearchResult {
  text: string;
  sources: Array<{ title: string; uri: string }>;
  searchQueries: string[];
  searchNotice: string;
}

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

export async function searchClientLive(query: string): Promise<ClientSearchResult> {
  const sources: Array<{ title: string; uri: string }> = [];
  const searchQueries: string[] = [query];
  const findings: string[] = [];

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
            const btc = data.bitcoin ? `$${data.bitcoin.usd?.toLocaleString()} (${data.bitcoin.usd_24h_change?.toFixed(2)}% 24h)` : "N/A";
            const eth = data.ethereum ? `$${data.ethereum.usd?.toLocaleString()} (${data.ethereum.usd_24h_change?.toFixed(2)}% 24h)` : "N/A";
            const sol = data.solana ? `$${data.solana.usd?.toLocaleString()} (${data.solana.usd_24h_change?.toFixed(2)}% 24h)` : "N/A";

            findings.push(
              `### Live Cryptocurrency Rates\n` +
              `* **Bitcoin (BTC)**: ${btc}\n` +
              `* **Ethereum (ETH)**: ${eth}\n` +
              `* **Solana (SOL)**: ${sol}`
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
                  const fahrenheit = ((cw.temperature * 9) / 5 + 32).toFixed(1);
                  findings.push(
                    `### Current Weather for ${loc.name}, ${loc.country || ""}\n` +
                    `* **Temperature**: ${cw.temperature}°C (${fahrenheit}°F)\n` +
                    `* **Wind Speed**: ${cw.windspeed} km/h\n` +
                    `* **Updated**: ${new Date(cw.time).toLocaleTimeString()}`
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

  // 3. Wikipedia API Search (CORS enabled)
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
          const items = (data?.query?.search || []).slice(0, 3);
          for (const item of items) {
            const snippet = cleanText(item.snippet);
            const title = item.title;
            const uri = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
            findings.push(`**${title}**: ${snippet}...`);
            addSource(`${title} - Wikipedia`, uri);
          }
          if (items.length > 0) {
            searchQueries.push("Wikipedia Knowledge Base");
          }
        }
      } catch {
        // ignore error
      }
    })()
  );

  // 4. DuckDuckGo Instant Answer
  tasks.push(
    (async () => {
      try {
        const qEnc = encodeURIComponent(query);
        const res = await fetch(`https://api.duckduckgo.com/?q=${qEnc}&format=json`, {
          signal: AbortSignal.timeout(3500),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.AbstractText) {
            const heading = data.Heading || query;
            const abstract = cleanText(data.AbstractText);
            const uri = data.AbstractURL || "https://duckduckgo.com";
            findings.push(`**${heading}**: ${abstract}`);
            addSource(data.Heading || "DuckDuckGo Instant Overview", uri);
            searchQueries.push("DuckDuckGo Instant Knowledge");
          }
        }
      } catch {
        // ignore error
      }
    })()
  );

  await Promise.allSettled(tasks);

  let text = "";
  if (findings.length > 0) {
    text =
      `Here is what I found online for **"${query}"**:\n\n` +
      findings.join("\n\n") +
      "\n\n" +
      (sources.length > 0
        ? "### Verified Sources:\n" + sources.slice(0, 6).map((s) => `* [${s.title}](${s.uri})`).join("\n")
        : "");
  } else {
    text = `I searched online for **"${query}"**, but could not find direct matching encyclopedia or live records. Please try asking with more specific keywords.`;
  }

  return {
    text,
    sources: sources.slice(0, 6),
    searchQueries: Array.from(new Set(searchQueries)),
    searchNotice:
      "Grounded with live web search. Tip: In Vercel, ensure GEMINI_API_KEY is set in Project Settings > Environment Variables for full AI responses.",
  };
}
