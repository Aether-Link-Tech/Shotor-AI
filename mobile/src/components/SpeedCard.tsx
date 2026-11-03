import { useState } from 'react';
import { Text } from 'react-native';
import { Button, Card, Pill, Row } from './ui';
import { lastSpeedResult, runSpeedTest, type SpeedResult } from '../lib/ai/engine';
import { activeModel } from '../lib/ai/models';
import { useLive } from '../lib/db';
import { colors, type } from '../theme';

const mins = (s: number) => (s < 90 ? `${Math.round(s)} seconds` : `${(s / 60).toFixed(1)} minutes`);

/** Engine builds without the fast ARM instructions; seeing one means the phone runs far below its potential. */
const SLOW_ENGINES = /^rnllama_jni(_v8)?$/;

/** Settings card: measures this phone, picks the fastest settings, and explains the result in plain words. */
export function SpeedCard() {
  const model = useLive(['model', 'settings'], () => activeModel());
  const [result, setResult] = useState<SpeedResult | null>(lastSpeedResult());
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState('');

  async function run() {
    setError('');
    setRunning(true);
    try {
      const { best } = await runSpeedTest(setStep);
      setResult(best);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      setStep('');
    }
  }

  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={type.h3}>AI speed on this phone</Text>
        {result ? <Pill label={result.estimate600 < 120 ? 'FAST' : result.estimate600 < 300 ? 'OK' : 'SLOW'} tone={result.estimate600 < 120 ? 'success' : result.estimate600 < 300 ? 'warn' : 'danger'} /> : null}
      </Row>
      {result ? (
        <>
          <Text style={type.body}>A 600-word report takes about {mins(result.estimate600)}.</Text>
          <Text style={type.small}>
            Reading {(result.readTps * 0.75).toFixed(1)} · writing {(result.writeTps * 0.75).toFixed(1)} words/sec · {result.gpu ? 'graphics chip' : `${result.threads} CPU cores`}
          </Text>
          <Text style={type.tiny}>Engine: {result.engine} · {result.gpuNote}</Text>
          {SLOW_ENGINES.test(result.engine) ? (
            <Text style={{ color: colors.warn, fontSize: 13 }}>This phone is using the basic engine build. Please report this phone model to Aether Link.</Text>
          ) : null}
          {result.estimate600 > 180 && model && ['llama-3.2-3b', 'gemma-3-4b', 'qwen3-4b'].includes(model.info.id) ? (
            <Text style={{ color: colors.warn, fontSize: 13 }}>
              Tip: “Qwen 3 1.7B (fast)” in AI model settings is about 1.5× faster, but a little less accurate.
            </Text>
          ) : null}
        </>
      ) : (
        <Text style={type.small}>Measure this phone once. Shotor then uses the fastest settings (CPU cores or graphics chip).</Text>
      )}
      {running ? <Text style={type.small}>{step || 'Starting…'} This takes about a minute.</Text> : null}
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      <Button small variant="secondary" title={result ? 'Test again' : 'Run speed test'} onPress={run} loading={running} disabled={!model} />
    </Card>
  );
}
