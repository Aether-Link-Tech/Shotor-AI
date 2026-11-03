import { useEffect, useState } from 'react';
import { AppState, Platform, Text } from 'react-native';
import { Button, Card } from './ui';
import { batteryUnrestricted, requestBatteryUnrestricted } from '../lib/background';
import { colors, type } from '../theme';

/** Settings card: makes sure the phone's battery saver can't stop a report that runs in the background. */
export function BatteryCard() {
  const [ok, setOk] = useState(batteryUnrestricted());
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && setOk(batteryUnrestricted()));
    return () => sub.remove();
  }, []);
  if (Platform.OS !== 'android') return null;
  return (
    <Card>
      <Text style={type.h3}>Background work</Text>
      {ok ? (
        <Text style={type.small}>✓ Reports and downloads keep running after you leave or close the app.</Text>
      ) : (
        <>
          <Text style={type.small}>
            The phone's battery saver may stop reports when you close the app. Allow Shotor to run in the background so they always finish.
          </Text>
          <Text style={[type.small, { color: colors.muted }]}>Uses battery only while a report or download is running.</Text>
          <Button small title="Allow background work" onPress={requestBatteryUnrestricted} />
        </>
      )}
    </Card>
  );
}
