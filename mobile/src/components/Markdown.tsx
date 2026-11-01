import { Fragment } from 'react';
import { StyleSheet, Text, TextStyle, View } from 'react-native';
import { colors } from '../theme';

/** Renders **bold** spans inside a line. */
function inline(text: string, base: TextStyle) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <Text style={base}>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <Text key={i} style={{ fontWeight: '700' }}>{p.slice(2, -2)}</Text>
        ) : (
          <Fragment key={i}>{p.replace(/(^|\s)\*([^*]+)\*/g, '$1$2')}</Fragment>
        ),
      )}
    </Text>
  );
}

/** Minimal Markdown for model output: headings, bullets, numbered lists, bold. */
export function Markdown({ text, color = colors.text }: { text: string; color?: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const body: TextStyle = { fontSize: 15, lineHeight: 22, color };
  return (
    <View style={{ gap: 4 }}>
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <View key={i} style={{ height: 4 }} />;
        const h = line.match(/^#{1,4}\s+(.*)/);
        if (h) return <Fragment key={i}>{inline(h[1], { ...body, ...styles.heading })}</Fragment>;
        const b = line.match(/^\s*[-*•]\s+(.*)/);
        if (b)
          return (
            <View key={i} style={styles.listRow}>
              <Text style={[body, styles.bullet]}>•</Text>
              <View style={{ flex: 1 }}>{inline(b[1], body)}</View>
            </View>
          );
        const n = line.match(/^\s*(\d+)[.)]\s+(.*)/);
        if (n)
          return (
            <View key={i} style={styles.listRow}>
              <Text style={[body, styles.bullet]}>{n[1]}.</Text>
              <View style={{ flex: 1 }}>{inline(n[2], body)}</View>
            </View>
          );
        return <Fragment key={i}>{inline(line, body)}</Fragment>;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontWeight: '700', fontSize: 16, marginTop: 6, color: colors.ink },
  listRow: { flexDirection: 'row', gap: 8, paddingLeft: 2 },
  bullet: { width: 18, color: colors.navySoft },
});
