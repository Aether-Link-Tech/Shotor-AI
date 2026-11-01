import { Redirect, Tabs } from 'expo-router';
import { getSetting } from '../../lib/db';
import { HeaderTitle } from '../../components/Brand';
import { ChatIcon, HomeIcon, MailIcon, ReportIcon, SettingsIcon } from '../../components/Icons';
import { colors } from '../../theme';

export default function TabLayout() {
  // First launch: run the setup flow (name, permissions, AI model, app lock).
  if (getSetting('onboarding.done') !== '1') return <Redirect href="/welcome" />;
  return (
    <Tabs
      screenOptions={{
        headerTitleAlign: 'left',
        headerStyle: { backgroundColor: colors.white },
        headerShadowVisible: false,
        tabBarActiveTintColor: colors.navy,
        tabBarInactiveTintColor: colors.faint,
        tabBarStyle: { borderTopColor: colors.line },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Today', headerTitle: () => <HeaderTitle title="Shotor AI" />, tabBarIcon: ({ color }) => <HomeIcon color={color} /> }}
      />
      <Tabs.Screen
        name="reports"
        options={{ title: 'Reports', headerTitle: () => <HeaderTitle title="Reports" />, tabBarIcon: ({ color }) => <ReportIcon color={color} /> }}
      />
      <Tabs.Screen
        name="chat"
        options={{ title: 'Ask AI', headerTitle: () => <HeaderTitle title="Ask Shotor" />, tabBarIcon: ({ color }) => <ChatIcon color={color} /> }}
      />
      <Tabs.Screen
        name="mail"
        options={{ title: 'Mail', headerTitle: () => <HeaderTitle title="Mail" />, tabBarIcon: ({ color }) => <MailIcon color={color} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', headerTitle: () => <HeaderTitle title="Settings" />, tabBarIcon: ({ color }) => <SettingsIcon color={color} /> }}
      />
    </Tabs>
  );
}
