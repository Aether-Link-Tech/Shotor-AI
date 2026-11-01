import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Empty, Pill, Row } from '../../components/ui';
import { Watermark } from '../../components/Brand';
import { PlusIcon } from '../../components/Icons';
import { db, useLive } from '../../lib/db';
import type { Report } from '../../lib/assistant';
import { colors, type } from '../../theme';

type Item = Pick<Report, 'id' | 'title' | 'source' | 'summary' | 'created_at'>;

export default function Reports() {
  const reports = useLive(['reports'], () =>
    db.getAllSync<Item>('SELECT id, title, source, substr(summary, 1, 400) AS summary, created_at FROM reports ORDER BY created_at DESC'),
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Watermark />
      <FlatList
        data={reports}
        keyExtractor={(r) => String(r.id)}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 100 }}
        ListEmptyComponent={
          <Empty
            title="No reports yet"
            body="Upload a PDF, Word, PowerPoint or Excel file — or paste text — and get a short summary written on this phone."
          />
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/report/${item.id}`)} style={({ pressed }) => [styles.item, pressed && { opacity: 0.8 }]}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={type.tiny}>{new Date(item.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
              {item.summary ? <Pill label={item.source.toUpperCase()} tone="navy" /> : <Pill label="NOT SUMMARIZED" tone="warn" />}
            </Row>
            <Text style={type.h3} numberOfLines={2}>
              {item.title}
            </Text>
            {item.summary ? (
              <Text style={type.small} numberOfLines={3}>
                {item.summary.replace(/\*\*/g, '').replace(/\s+/g, ' ')}
              </Text>
            ) : null}
          </Pressable>
        )}
      />
      <View style={styles.fab}>
        <Button title="New report" icon={<PlusIcon color={colors.white} />} onPress={() => router.push('/report/new')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  item: { backgroundColor: colors.card, borderRadius: 16, padding: 14, gap: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  fab: { position: 'absolute', right: 16, bottom: 16, left: 16 },
});
