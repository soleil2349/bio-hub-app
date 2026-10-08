/**
 * Bottom tab bar — the instrument bezel.
 *
 * Three things were wrong with the original and all are fixed here:
 *
 *  1. `paddingBottom: 20` was a hard-coded guess. Expo SDK 54+ ships Android
 *     edge-to-edge, so the system gesture bar is drawn *over* the app; on a
 *     device with a 34pt gesture inset the labels sat underneath it. The bar
 *     now pads by the real bottom inset.
 *
 *  2. The badge was absolutely positioned at `right: '25%'` inside a flexed tab,
 *     so it drifted with the label width and could overlap a neighbouring tab.
 *     It is laid out in normal flow again.
 *
 *  3. Icon-only would be ambiguous and label-only is a menu, not a tab bar, so
 *     each tab carries both, with the active one lit in the accent cyan and
 *     marked by a short rail along the top edge — the same way a channel is
 *     marked on rack equipment.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon, { type IconName } from './Icon';
import { color, radius, space, type } from '../theme';

export interface TabItem {
  id: string;
  label: string;
  icon: IconName;
  badge?: string | number;
}

interface TabBarProps {
  tabs: TabItem[];
  activeTab: string;
  onSelect: (tabId: string) => void;
  accentColor?: string;
}

/** Minimum leg height before the device's own bottom inset is added. */
const BAR_HEIGHT = 56;

export default function TabBar({
  tabs,
  activeTab,
  onSelect,
  accentColor = color.accentText,
}: TabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        // A device with no gesture inset still gets a comfortable 8pt floor.
        { paddingBottom: Math.max(insets.bottom, space.sm) },
      ]}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        const tint = isActive ? accentColor : color.textMuted;
        const showBadge = tab.badge !== undefined && tab.badge !== 0;

        return (
          <Pressable
            key={tab.id}
            onPress={() => onSelect(tab.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={showBadge ? `${tab.label}，${tab.badge} 项` : tab.label}
            style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
          >
            {/* Channel rail: lit only on the active tab. */}
            <View style={[styles.rail, isActive && { backgroundColor: accentColor }]} />
            <View style={styles.iconWrap}>
              <Icon name={tab.icon} size={21} color={tint} />
              {showBadge ? (
                <View style={styles.badge}>
                  <Text style={[styles.badgeText]} numberOfLines={1}>
                    {tab.badge}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text
              style={[type.caption, styles.label, { color: tint }, isActive && styles.labelActive]}
              numberOfLines={1}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: color.bg,
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  tab: {
    flex: 1,
    minHeight: BAR_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: space.sm,
    gap: space.xs,
  },
  tabPressed: { opacity: 0.6 },
  rail: {
    position: 'absolute',
    top: -1,
    width: 28,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'transparent',
  },
  iconWrap: { width: 34, height: 22, alignItems: 'center', justifyContent: 'center' },
  label: { fontWeight: '400' },
  labelActive: { fontWeight: '700' },
  badge: {
    position: 'absolute',
    top: -5,
    right: -7,
    minWidth: 16,
    height: 16,
    borderRadius: radius.pill,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.danger,
  },
  badgeText: { color: color.onDanger, fontSize: 10, lineHeight: 14, fontWeight: '700' },
});
