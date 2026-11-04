import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Row, Screen } from '../../components/ui';
import { MailIcon } from '../../components/Icons';
import { getSetting } from '../../lib/db';
import { connectImap, detectServers, imapSupported, type Detected, type Security, type ServerSettings } from '../../lib/mail/imap';
import { runSync } from '../../lib/sync';
import { colors, radius, type } from '../../theme';

const SECURITY: { key: Security; label: string }[] = [
  { key: 'ssl', label: 'SSL/TLS' },
  { key: 'starttls', label: 'STARTTLS' },
  { key: 'none', label: 'None' },
];

/** Sign in to a work mailbox that is not Gmail (e.g. name@company.com on Hostinger). */
export default function ConnectWorkEmail() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [detected, setDetected] = useState<Detected | null>(null);
  const [servers, setServers] = useState<ServerSettings | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function detect() {
    if (!validEmail) return;
    const d = await detectServers(email.trim());
    setDetected(d);
    setServers(d.settings);
  }

  async function connect() {
    setError('');
    setBusy(true);
    try {
      const s = servers ?? (await detectServers(email.trim())).settings;
      await connectImap({ ...s, email: email.trim(), password, name: getSetting('user.name', '').trim() });
      runSync().catch(() => {});
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!imapSupported()) {
    return (
      <Screen>
        <Card>
          <Text style={type.body}>Work email (non-Gmail) is available on Android. iPhone support is coming in a later version.</Text>
        </Card>
      </Screen>
    );
  }

  const set = (patch: Partial<ServerSettings>) => setServers((s) => ({ ...(s ?? detected!.settings), ...patch }));

  return (
    <Screen>
      <Card>
        <Row>
          <MailIcon color={colors.navy} />
          <Text style={type.h2}>Work email</Text>
        </Row>
        <Text style={type.small}>
          For company addresses that are not Gmail, such as name@company.com on Hostinger. Your password is stored encrypted on this phone and is only sent to your mail server.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="Email address"
          placeholderTextColor={colors.faint}
          value={email}
          onChangeText={(t) => {
            setEmail(t);
            setDetected(null);
            setServers(null);
          }}
          onEndEditing={detect}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
        />
        <TextInput
          style={styles.input}
          placeholder="Email password"
          placeholderTextColor={colors.faint}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="password"
        />

        {detected ? (
          <View style={{ gap: 4 }}>
            <Text style={type.small}>
              Server: <Text style={{ fontWeight: '700', color: colors.ink }}>{detected.label}</Text> ({servers?.imapHost})
            </Text>
            {detected.note ? <Text style={[type.small, { color: colors.warn }]}>{detected.note}</Text> : null}
            <Text style={styles.link} onPress={() => setAdvanced(!advanced)}>
              {advanced ? 'Hide server settings' : 'Change server settings'}
            </Text>
          </View>
        ) : null}

        {advanced && servers ? (
          <View style={{ gap: 8 }}>
            <ServerRow
              title="Incoming (IMAP)"
              host={servers.imapHost}
              port={servers.imapPort}
              security={servers.imapSecurity}
              onChange={(h, p, sec) => set({ imapHost: h, imapPort: p, imapSecurity: sec })}
            />
            <ServerRow
              title="Outgoing (SMTP)"
              host={servers.smtpHost}
              port={servers.smtpPort}
              security={servers.smtpSecurity}
              onChange={(h, p, sec) => set({ smtpHost: h, smtpPort: p, smtpSecurity: sec })}
            />
            {servers.imapSecurity === 'none' || servers.smtpSecurity === 'none' ? (
              <Text style={[type.small, { color: colors.danger }]}>Without SSL/TLS or STARTTLS your password is sent unprotected. Use “None” only on a company network.</Text>
            ) : null}
          </View>
        ) : null}

        {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
        <Button title={busy ? 'Checking…' : 'Connect'} onPress={connect} loading={busy} disabled={!validEmail || !password || busy} />
      </Card>
      <Text style={[type.tiny, { textAlign: 'center' }]}>Shotor reads your inbox and sends replies through your own mail server. Nothing goes to Aether Link.</Text>
    </Screen>
  );
}

function ServerRow(p: { title: string; host: string; port: number; security: Security; onChange: (host: string, port: number, security: Security) => void }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={type.small}>{p.title}</Text>
      <Row>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={p.host}
          onChangeText={(h) => p.onChange(h.trim(), p.port, p.security)}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="server"
          placeholderTextColor={colors.faint}
        />
        <TextInput
          style={[styles.input, { width: 80 }]}
          value={String(p.port)}
          onChangeText={(t) => p.onChange(p.host, Number(t.replace(/[^0-9]/g, '')) || 0, p.security)}
          keyboardType="number-pad"
        />
      </Row>
      <Row>
        {SECURITY.map((s) => (
          <Pressable key={s.key} onPress={() => p.onChange(p.host, p.port, s.key)} style={[styles.chip, p.security === s.key && styles.chipOn]}>
            <Text style={[styles.chipText, p.security === s.key && { color: colors.white }]}>{s.label}</Text>
          </Pressable>
        ))}
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  input: { backgroundColor: colors.bg, borderRadius: radius.md, padding: 12, fontSize: 15, color: colors.text },
  link: { color: colors.navySoft, fontWeight: '600', fontSize: 14 },
  chip: { backgroundColor: '#E3E9F5', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: colors.navy },
  chipText: { color: colors.navy, fontWeight: '600', fontSize: 13 },
});
