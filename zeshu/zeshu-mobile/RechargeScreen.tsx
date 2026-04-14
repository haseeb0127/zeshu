import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Picker } from '@react-native-picker/picker'; // You may need to run: npx expo install @react-native-picker/picker

// Keep the same commission rates exactly as the web
const COMMISSION_RATES: { [key: string]: number } = {
  'Vodafone': 3.70, 'RELIANCE - JIO': 0.65, 'Airtel': 1.00, 'BSNL - STV': 3.00, 'BSNL - TOPUP': 3.00, 'Idea': 3.70,
  'DISH TV': 3.80, 'Airtel Digital DTH TV': 4.20, 'SUNDIRECT DTH TV': 3.50, 'VIDEOCON DTH TV': 4.20, 'TATASKY DTH TV': 3.20,
};

const PROVIDERS = {
  Prepaid: ['Airtel', 'RELIANCE - JIO', 'Vodafone', 'Idea', 'BSNL - TOPUP', 'BSNL - STV'],
  Postpaid: ['Airtel Postpaid', 'BSNL Postpaid', 'JIO POSTPAID', 'Vodafone Postpaid'],
  DTH: ['Airtel Digital DTH TV', 'DISH TV', 'SUNDIRECT DTH TV', 'TATASKY DTH TV', 'VIDEOCON DTH TV'],
  Electricity: ['Adani power', 'BSES Rajdhani Power Limited - Delhi', 'Tata Power - MUMBAI', 'TNEB - TAMIL NADU', 'TSNPDCL Telangana northern power'], // Add the rest of the list here
  Gas: ['Adani Gas', 'Gujarat Gas', 'Indraprastha Gas'],
  Insurance: ['ICICI Prudential Insurance', 'Tata AIA Insurance']
};

export default function MobileRechargeScreen() {
  const [activeTab, setActiveTab] = useState('Prepaid');
  const [number, setNumber] = useState('');
  const [operator, setOperator] = useState('');
  const [amount, setAmount] = useState('');

  // Calculate Zeshu Coins (80% logic)
  const numericAmount = parseFloat(amount) || 0;
  const operatorMargin = COMMISSION_RATES[operator] || 0;
  const myProfit = numericAmount * (operatorMargin / 100);
  const customerCoinsEarned = Math.floor(myProfit * 0.80);

  const getInputLabel = () => {
    if (activeTab === 'Electricity') return 'Customer Account :';
    if (activeTab === 'Insurance') return 'Policy Number :';
    if (activeTab === 'DTH') return 'DTH Number :';
    return 'Mobile Number :';
  };

  return (
    <ScrollView style={styles.container}>
      {/* Category Scroller */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabContainer}>
        {Object.keys(PROVIDERS).map((cat) => (
          <TouchableOpacity 
            key={cat} 
            style={[styles.tab, activeTab === cat && styles.activeTab]}
            onClick={() => { setActiveTab(cat); setOperator(''); setAmount(''); }}
          >
            <Text style={[styles.tabText, activeTab === cat && styles.activeTabText]}>{cat}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Form Container */}
      <View style={styles.formContainer}>
        {/* Gradient Header Mimic */}
        <View style={styles.header}>
          <Text style={styles.headerText}>{activeTab.toUpperCase()} RECHARGE</Text>
        </View>

        <View style={styles.formBody}>
          <Text style={styles.label}>{getInputLabel()}</Text>
          <TextInput 
            style={styles.input}
            placeholder={`Please Enter ${getInputLabel().replace(' :', '')}`}
            value={number}
            onChangeText={setNumber}
          />

          <Text style={styles.label}>Select Provider :</Text>
          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={operator}
              onValueChange={(itemValue) => setOperator(itemValue)}
            >
              <Picker.Item label="Select Operator*" value="" color="#999" />
              {PROVIDERS[activeTab as keyof typeof PROVIDERS].map(op => (
                <Picker.Item key={op} label={op} value={op} />
              ))}
            </Picker>
          </View>

          <Text style={styles.label}>Amount :</Text>
          <TextInput 
            style={styles.input}
            placeholder="Amount"
            keyboardType="numeric"
            value={amount}
            onChangeText={setAmount}
          />

          {amount !== '' && customerCoinsEarned > 0 && (
            <Text style={styles.coinText}>🎉 Earn {customerCoinsEarned} Zeshu Coins!</Text>
          )}

          <TouchableOpacity style={styles.button}>
            <Text style={styles.buttonText}>Recharge</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9f9f9', padding: 16 },
  tabContainer: { flexDirection: 'row', marginBottom: 20 },
  tab: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 20, backgroundColor: '#fff', marginRight: 10, borderWidth: 1, borderColor: '#eee' },
  activeTab: { backgroundColor: '#ffe4f0', borderColor: '#ff69b4' },
  tabText: { color: '#666', fontWeight: 'bold' },
  activeTabText: { color: '#e0247d' },
  formContainer: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#eee' },
  header: { backgroundColor: '#6B46C1', padding: 16 }, // Note: React Native doesn't support linear gradients natively without expo-linear-gradient, so we use solid purple here
  headerText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  formBody: { padding: 16, backgroundColor: '#fdfdfd' },
  label: { fontWeight: 'bold', color: '#333', marginBottom: 8, marginTop: 12 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, backgroundColor: '#fff', fontSize: 16 },
  pickerContainer: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, backgroundColor: '#fff', marginBottom: 10 },
  coinText: { color: '#16a34a', fontWeight: 'bold', marginTop: 8 },
  button: { backgroundColor: '#6B46C1', padding: 16, borderRadius: 8, alignItems: 'center', marginTop: 20 },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 }
});