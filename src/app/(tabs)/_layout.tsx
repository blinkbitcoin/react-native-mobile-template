import { Tabs } from 'expo-router';
import { TabIcon } from '../../components/TabIcon';

export default function TabsLayout() {
  return (
    <Tabs>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarButtonTestID: 'tab-home',
          tabBarIcon: (props) => <TabIcon name="home" testID="tab-home-icon" {...props} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarButtonTestID: 'tab-settings',
          tabBarIcon: (props) => <TabIcon name="settings" testID="tab-settings-icon" {...props} />,
        }}
      />
    </Tabs>
  );
}
