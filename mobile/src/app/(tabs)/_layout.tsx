import { Pressable } from 'react-native';
import { Redirect, Tabs, router } from 'expo-router';
import { getSetting } from '../../lib/db';
import { HeaderTitle } from '../../components/Brand';
import { CalendarIcon, ChatIcon, HomeIcon, MailIcon, ReportIcon, SettingsIcon } from '../../components/Icons';
import { colors } from '../../theme';

/** Settings is a normal screen (src/app/settings.tsx) opened from the gear in every tab header. */
function SettingsButton() {
  return (
    <Pressable onPress={() => router.push('/settings')} hitSlop={12} style={{ paddingHorizontal: 16 }} accessibilityRole="button" accessibilityLabel="Settings">
      <SettingsIcon color={colors.navy} />
    </Pressable>
  );
}

export default function TabLayout() {
  // First launch: run the setup flow (name, permissions, AI model, app lock).
  if (getSetting('onboarding.done') !== '1') return <Redirect href="/welcome" />;
  return (
    <Tabs
      screenOptions={{
        headerTitleAlign: 'left',
        headerStyle: { backgroundColor: colors.white },
        headerShadowVisible: false,
        headerRight: () => <SettingsButton />,
        tabBarActiveTintColor: colors.navy,
        tabBarInactiveTintColor: colors.faint,
        tabBarStyle: { borderTopColor: colors.line },
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Today', headerTitle: () => <HeaderTitle title="Shotor AI" />, tabBarIcon: ({ color }) => <HomeIcon color={color} /> }}
      />
      <Tabs.Screen
        name="calendar"
        options={{ title: 'Calendar', headerTitle: () => <HeaderTitle title="Calendar" />, tabBarIcon: ({ color }) => <CalendarIcon size={24} color={color} /> }}
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
    </Tabs>
  );
}
