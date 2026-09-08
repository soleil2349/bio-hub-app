/**
 * Custom bottom tab bar component with dark theme styling.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export interface TabItem {
  id: string;
  label: string;
  badge?: string | number;
}

interface TabBarProps {
  tabs: TabItem[];
  activeTab: string;
  onSelect: (tabId: string) => void;
  accentColor?: string;
}

export default function TabBar({
  tabs,
  activeTab,
  onSelect,
  accentColor = '#4A90D9',
}: TabBarProps) {
  return (
    <View style={styles.container}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <TouchableOpacity
            key={tab.id}
            style={[styles.tab, isActive && styles.tabActive]}
            onPress={() => onSelect(tab.id)}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.indicator,
                isActive && { backgroundColor: accentColor },
              ]}
            />
            <Text
              style={[
                styles.label,
                isActive && { color: accentColor, fontWeight: '700' },
              ]}
            >
              {tab.label}
            </Text>
            {tab.badge !== undefined && tab.badge !== 0 && (
              <View style={[styles.badge, { backgroundColor: accentColor }]}>
                <Text style={styles.badgeText}>{tab.badge}</Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#111827',
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
    paddingBottom: 20,
    paddingTop: 4,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  tabActive: {},
  indicator: {
    width: 20,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'transparent',
    marginBottom: 4,
  },
  label: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: '25%',
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    fontSize: 9,
    color: '#fff',
    fontWeight: '700',
  },
});
