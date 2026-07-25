/**
 * Sparkplug-B-STYLE topic namespace — style, not compliance (JSON payloads,
 * no birth/death lifecycle; see docs/00-domain-research.md §7 and
 * PROJECT.md "Out of Scope").
 *
 * Topic shape: spBv1.0/LineLens/DDATA/<lineId>/<machineId>
 */
export const topicFor = (e: { lineId: string; machineId: string }): string =>
  `spBv1.0/LineLens/DDATA/${e.lineId}/${e.machineId}`;

export const TELEMETRY_SUBSCRIPTION = 'spBv1.0/LineLens/DDATA/+/+';

export interface TopicParts {
  lineId: string;
  machineId: string;
}

const TOPIC_RE = /^spBv1\.0\/LineLens\/DDATA\/([^/]+)\/([^/]+)$/;

export const parseTopic = (topic: string): TopicParts | null => {
  const match = TOPIC_RE.exec(topic);
  if (!match) return null;
  const [, lineId, machineId] = match;
  if (!lineId || !machineId) return null;
  return { lineId, machineId };
};
