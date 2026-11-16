import { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Row, Screen } from '../../components/ui';
import { MailIcon } from '../../components/Icons';
import { detectServers, imapSupported, serverChoices, type Detected, type Security, type ServerSettings } from '../../lib/mail/imap';
import { runSync } from '../../lib/sync';
import { autoConnect, ConnectError, type Attempt } from '../../lib/mail/autoconnect';
import { connectGmail, isGmailConfigured } from '../../lib/gmail/auth';
import { colors, radius, type } from '../../theme';

const SECURITY: { key: Security; label: string }[] = [
  { key: 'ssl', label: 'SSL/TLS' },
  { key: 'starttls', label: 'STARTTLS' },
  { key: 'none', label: 'None' },
];

/** Providers that refuse the normal password in other apps and need an "app password" instead. */
const APP_PASSWORD: Record<string, { name: string; url: string; steps: string[] }> = {
  gmail: {
    name: 'Gmail',
    url: 'https://myaccount.google.com/apppasswords',
    steps: [
      'Make sure 2-Step Verification is on (Google Account → Security).',
      'Tap the button below, sign in, type "Shotor" as the name and tap Create.',
      'Copy the 16-letter password Google shows and paste it in the password box here.',
    ],
  },
  yahoo: {
    name: 'Yahoo',
    url: 'https://login.yahoo.com/account/security',
    steps: ['Tap the button below and open "Generate app password".', 'Name it "Shotor" and copy the password.', 'Paste it in the password box here.'],
  },
  icloud: {
    name: 'iCloud',
    url: 'https://account.apple.com/account/manage',
    steps: ['Tap the button below and open "App-Specific Passwords".', 'Create one named "Shotor" and copy it.', 'Paste it in the password box here.'],
  },
  aol: {
    name: 'AOL',
    url: 'https://login.aol.com/account/security',
    steps: ['Tap the button below and open "Generate app password".', 'Name it "Shotor" and copy the password.', 'Paste it in the password box here.'],
  },
};

/** Connect any email address: the provider is detected, and app-password steps are shown where needed. */
export default function ConnectWorkEmail() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [detected, setDetected] = useState<Detected | null>(null);
  const [servers, setServers] = useState<ServerSettings | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState('');
  const [attempts, setAttempts] = useState<Attempt[]>([]);

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function detect() {
    if (!validEmail) return;
    const d = await detectServers(email.trim());
    setDetected(d);
    setServers(d.settings);
  }

  async function connect() {
    setError('');
    setAttempts([]);
    setBusy(true);
    try {
      // If the provider is still unknown (the first lookup can time out on a slow network), look it up again.
      let s = servers;
      if (!s || !detected || detected.provider === 'other') {
        setStep('Finding your email provider…');
        const d = await detectServers(email.trim());
        if (!servers || d.provider !== 'other') {
          setDetected(d);
          setServers(d.settings);
          s = d.settings;
        }
      }
      // App passwords are shown in groups ("abcd efgh ijkl mnop") but contain no spaces.
      const provider = (s && detected?.provider) || '';
      const pw = APP_PASSWORD[provider] ? password.replace(/\s+/g, '') : password;
      // Tries the chosen servers first, then every usual server name, port and login style by itself.
      const r = await autoConnect(email.trim(), pw, s ?? null, setStep);
      runSync().catch(() => {});
      if (!r.canSend) {
        Alert.alert(
          'Connected — reading works',
          'This network blocks sending email right now (common on some mobile data). Your replies wait in the Outbox and are sent automatically when the phone is on Wi-Fi or another network.',
          [{ text: 'OK', onPress: () => router.back() }],
        );
      } else router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (e instanceof ConnectError) setAttempts(e.attempts);
    } finally {
      setBusy(false);
      setStep('');
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

  const appPw = detected ? APP_PASSWORD[detected.provider] : undefined;

  async function googleSignIn() {
    setError('');
    try {
      await connectGmail();
      runSync().catch(() => {});
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const set = (patch: Partial<ServerSettings>) => setServers((s) => ({ ...(s ?? detected!.settings), ...patch }));

  return (
    <Screen>
      <Card>
        <Row>
          <MailIcon color={colors.navy} />
          <Text style={type.h2}>Connect your email</Text>
        </Row>
        <Text style={type.small}>
          Any address: company email (for example on Hostinger), Gmail, Yahoo and more. Your password is stored encrypted on this phone and is only sent to your own mail server.
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
          placeholder={appPw ? `${appPw.name} app password (not your normal password)` : 'Email password'}
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
            {appPw ? (
              <View style={styles.appPw}>
                <Text style={type.h3}>{appPw.name} needs an app password</Text>
                <Text style={type.small}>{appPw.name} does not accept your normal password in other apps. Create an app password once:</Text>
                {appPw.steps.map((st, i) => (
                  <Text key={i} style={type.small}>
                    {i + 1}. {st}
                  </Text>
                ))}
                <Button small variant="secondary" title={`Open ${appPw.name} app passwords`} onPress={() => Linking.openURL(appPw.url)} />
                {detected.provider === 'gmail' && isGmailConfigured() ? (
                  <Text style={styles.link} onPress={googleSignIn}>
                    Or sign in with Google (only for accounts your administrator added)
                  </Text>
                ) : null}
              </View>
            ) : detected.note ? (
              <Text style={[type.small, { color: colors.warn }]}>{detected.note}</Text>
            ) : null}
            <Text style={type.tiny}>Not right? Choose your email provider:</Text>
            <Row style={{ flexWrap: 'wrap' }}>
              {serverChoices(email).map((c) => (
                <Pressable
                  key={c.label}
                  onPress={() => {
                    setDetected(c);
                    setServers(c.settings);
                  }}
                  style={[styles.chip, servers?.imapHost === c.settings.imapHost && styles.chipOn]}
                >
                  <Text style={[styles.chipText, servers?.imapHost === c.settings.imapHost && { color: colors.white }]}>{c.label}</Text>
                </Pressable>
              ))}
            </Row>
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
        {attempts.length ? (
          <View style={styles.attempts}>
            <Text style={type.tiny}>What each server answered (send a screenshot of this to support):</Text>
            {attempts.map((a, i) => (
              <Text key={i} style={[type.tiny, { color: a.result === 'ok' ? colors.success : colors.text }]}>
                {a.step === 'reading' ? 'IN ' : 'OUT'} {a.server} · {a.login} → {a.result === 'ok' ? 'OK' : a.detail}
              </Text>
            ))}
          </View>
        ) : null}
        {busy && step ? <Text style={type.small}>{step}</Text> : null}
        <Button title={busy ? 'Finding your mail server…' : 'Connect'} onPress={connect} loading={busy} disabled={!validEmail || !password || busy} />
      </Card>
      <Text style={[type.tiny, { textAlign: 'center' }]}>Shotor reads your inbox and sends replies through your own mail server. Nothing goes to Aether Nova.</Text>
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
  attempts: { backgroundColor: colors.bg, borderRadius: radius.md, padding: 10, gap: 3 },
  appPw: { backgroundColor: '#E3E9F5', borderRadius: radius.md, padding: 12, gap: 6 },
});
