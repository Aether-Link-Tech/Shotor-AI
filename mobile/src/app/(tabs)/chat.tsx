import { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { Markdown } from '../../components/Markdown';
import { LogoMark, Watermark } from '../../components/Brand';
import { ModelBanner, useEngine } from '../../components/ModelBanner';
import { SendIcon } from '../../components/Icons';
import { Button } from '../../components/ui';
import { db, useLive } from '../../lib/db';
import { clearChat, sendChatMessage } from '../../lib/assistant';
import { stopGenerating } from '../../lib/ai/engine';
import { colors, radius, type } from '../../theme';

type Msg = { id: number; role: 'user' | 'assistant'; content: string };

const SUGGESTIONS = ['What is on my calendar this week?', 'Which emails need my reply?', 'What were the key risks in my latest report?', 'Draft talking points for my next meeting'];

export default function Chat() {
  const { model } = useEngine();
  const params = useLocalSearchParams<{ q?: string }>();
  const navigation = useNavigation();
  const messages = useLive(['chat'], () => db.getAllSync<Msg>('SELECT id, role, content FROM chat_messages ORDER BY id DESC LIMIT 200'));
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState('');
  const listRef = useRef<FlatList<Msg>>(null);

  useEffect(() => {
    if (params.q) setInput(params.q);
  }, [params.q]);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        messages.length ? (
          <Button
            small
            variant="ghost"
            title="Clear"
            onPress={() =>
              Alert.alert('Clear conversation?', 'This removes the chat history from this phone.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Clear', style: 'destructive', onPress: clearChat },
              ])
            }
          />
        ) : null,
    });
  }, [navigation, messages.length]);

  async function send(text = input) {
    const q = text.trim();
    if (!q || streaming !== null) return;
    setInput('');
    setError('');
    setStreaming('');
    try {
      await sendChatMessage(q, (t) => setStreaming(t));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStreaming(null);
    }
  }

  const data: Msg[] = streaming !== null ? [{ id: -1, role: 'assistant', content: streaming || '…' }, ...messages] : messages;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      {messages.length === 0 && streaming === null ? <Watermark /> : null}
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        <ModelBanner />
      </View>
      {data.length === 0 ? (
        // Rendered outside the inverted list: inverted lists flip their empty component on some
        // Android versions, which showed this text mirrored.
        <ScrollView contentContainerStyle={[styles.empty, { padding: 16 }]} keyboardShouldPersistTaps="handled">
          <Text style={type.h2}>Ask anything</Text>
          <Text style={[type.small, { textAlign: 'center' }]}>Answers are written on this phone using your meetings, recent email and report summaries. Nothing leaves the device.</Text>
          <View style={styles.suggestions}>
            {SUGGESTIONS.map((s) => (
              <Pressable key={s} style={styles.chip} onPress={() => send(s)} disabled={!model}>
                <Text style={styles.chipText}>{s}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      ) : (
      <FlatList
        ref={listRef}
        inverted
        data={data}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        renderItem={({ item }) =>
          item.role === 'user' ? (
            <View style={styles.userBubble}>
              <Text style={styles.userText}>{item.content}</Text>
            </View>
          ) : (
            <View style={styles.aiRow}>
              <LogoMark size={26} />
              <View style={styles.aiBubble}>
                <Markdown text={item.content} />
              </View>
            </View>
          )
        }
      />
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder={model ? 'Ask Shotor…' : 'Set up the AI model first'}
          placeholderTextColor={colors.faint}
          value={input}
          onChangeText={setInput}
          multiline
          editable={!!model}
        />
        {streaming !== null ? (
          <Button small variant="secondary" title="Stop" onPress={() => stopGenerating()} />
        ) : (
          <Pressable accessibilityLabel="Send" onPress={() => send()} disabled={!input.trim() || !model} style={[styles.send, (!input.trim() || !model) && { opacity: 0.4 }]}>
            <SendIcon color={colors.white} />
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  empty: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 30 },
  suggestions: { gap: 8, marginTop: 10, alignSelf: 'stretch' },
  chip: { backgroundColor: colors.white, borderRadius: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  chipText: { color: colors.navy, fontSize: 14 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: colors.navy, borderRadius: 18, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 10, maxWidth: '85%' },
  userText: { color: colors.white, fontSize: 15, lineHeight: 21 },
  aiRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', maxWidth: '92%' },
  aiBubble: { flexShrink: 1, backgroundColor: colors.white, borderRadius: 18, borderTopLeftRadius: 4, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, backgroundColor: colors.white, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  input: { flex: 1, maxHeight: 120, minHeight: 42, backgroundColor: colors.bg, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: colors.text },
  send: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  error: { color: colors.danger, paddingHorizontal: 16, paddingBottom: 6 },
});
