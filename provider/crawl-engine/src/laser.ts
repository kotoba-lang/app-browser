interface LaserEmbedRequest {
  texts: string[];
  lang: string;
  normalize: boolean;
}

interface LaserEmbedResponse {
  model: string;
  lang: string;
  dim: number;
  vectors: number[][];
}

interface LaserTopicLabel {
  name: string;
  description: string;
}

interface LaserClassification {
  label: string;
  score: number;
}

const DEFAULT_LASER_TOP_K = 5;

const DEFAULT_LASER_TOPICS: LaserTopicLabel[] = [
  { name: "real-estate-transactions", description: "Real estate purchase, sale, transfer, ownership change, title transfer, deed registration, escrow, settlement." },
  { name: "land-ownership-and-cadastre", description: "Land ownership records, parcel boundaries, cadastral map, parcel id, lot division, land registry, geospatial parcel references." },
  { name: "property-tax-and-valuation", description: "Property tax, land tax, assessment value, valuation method, tax notice, payment schedule, reassessment." },
  { name: "zoning-and-urban-planning", description: "Zoning regulation, urban planning, land use category, building restrictions, floor area ratio, development controls." },
  { name: "construction-and-permits", description: "Construction permit, building code approval, inspection result, occupancy permit, contractor filing, renovation permit." },
  { name: "general-news", description: "Breaking news, current affairs, press release, headline, report, announcement, journalism, media coverage." },
  { name: "technology", description: "Software, hardware, artificial intelligence, machine learning, cloud computing, cybersecurity, programming, data science." },
  { name: "business-and-finance", description: "Corporate earnings, stock market, investment, banking, revenue, profit, merger, acquisition, startup, venture capital." },
  { name: "government-and-policy", description: "Government policy, legislation, regulation, public sector, civil service, political affairs, governance." },
];

/** Classifies text content using LASER embeddings. */
export async function classifyWithLaser(
  laserBaseURL: string,
  textContent: string,
  labelsJSON: string | undefined,
  topK: number | undefined,
): Promise<string> {
  const text = normalizeText(textContent);
  if (!text) return "";

  // Parse labels.
  let labels = DEFAULT_LASER_TOPICS;
  if (labelsJSON) {
    try {
      const custom: LaserTopicLabel[] = JSON.parse(labelsJSON);
      if (Array.isArray(custom) && custom.length > 0) {
        labels = custom;
      }
    } catch {
      // use defaults
    }
  }

  const texts: string[] = [text];
  const usableLabels: LaserTopicLabel[] = [];

  for (const label of labels) {
    const desc = normalizeText(label.description?.trim() || "");
    if (!desc) continue;
    usableLabels.push({ name: label.name, description: desc });
    texts.push(desc);
  }

  if (usableLabels.length === 0) return "";

  const reqBody: LaserEmbedRequest = {
    texts,
    lang: "en",
    normalize: true,
  };

  const resp = await fetch(laserBaseURL + "/embed", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(reqBody),
    signal: AbortSignal.timeout(10_000),
  });

  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`laser embed failed status=${resp.status}`);
  }

  const parsed: LaserEmbedResponse = await resp.json() as LaserEmbedResponse;
  if (!parsed.vectors || parsed.vectors.length === 0 || parsed.vectors.length !== texts.length) {
    throw new Error("laser response vectors mismatch");
  }

  const docVector = parsed.vectors[0];
  const scores: LaserClassification[] = [];

  for (let i = 0; i < usableLabels.length; i++) {
    if (i + 1 >= parsed.vectors.length) break;
    const sim = cosineSimilarity(docVector, parsed.vectors[i + 1]);
    scores.push({
      label: usableLabels[i].name.trim(),
      score: Math.round(sim * 1_000_000) / 1_000_000,
    });
  }

  scores.sort((a, b) => b.score - a.score);

  const k = Math.min(topK && topK > 0 ? topK : DEFAULT_LASER_TOP_K, scores.length);
  return JSON.stringify(scores.slice(0, k));
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0;
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function normalizeText(v: string): string {
  return v.trim().split(/\s+/).join(" ");
}
