import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Dimensions, Alert } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { 
  Smartphone, PhoneCall, Tv, BadgeCheck, Car, Zap, 
  Flame, Package, Droplets, Wifi, Landmark, ShieldCheck, ChevronLeft
} from 'lucide-react-native';

const { width } = Dimensions.get('window');

// --- 12 ICON GRID DATA ---
const SERVICES = [
  { id: 'Prepaid', label: 'Prepaid', icon: Smartphone, color: '#f3e8ff', iconColor: '#7e22ce' },
  { id: 'Postpaid', label: 'Postpaid', icon: PhoneCall, color: '#e0e7ff', iconColor: '#4f46e5' },
  { id: 'DTH', label: 'DTH', icon: Tv, color: '#fff7ed', iconColor: '#ea580c' },
  { id: 'UPI', label: 'UPI Tools', icon: BadgeCheck, color: '#e0f2fe', iconColor: '#0284c7' },
  { id: 'Electricity', label: 'Electricity', icon: Zap, color: '#fefce8', iconColor: '#ca8a04' },
  { id: 'Gas', label: 'Piped Gas', icon: Flame, color: '#fef2f2', iconColor: '#dc2626' },
  { id: 'LPG', label: 'LPG Booking', icon: Package, color: '#fff1f2', iconColor: '#e11d48' },
  { id: 'Water', label: 'Water Bill', icon: Droplets, color: '#eff6ff', iconColor: '#2563eb' },
  { id: 'Broadband', label: 'Broadband', icon: Wifi, color: '#ecfeff', iconColor: '#0891b2' },
  { id: 'EMI', label: 'Loan EMI', icon: Landmark, color: '#ecfdf5', iconColor: '#059669' },
  { id: 'Insurance', label: 'Insurance', icon: ShieldCheck, color: '#f0fdfa', iconColor: '#0d9488' },
  { id: 'FASTag', label: 'FASTag', icon: Car, color: '#f0fdf4', iconColor: '#16a34a' },
];

const COMMISSION_RATES: { [key: string]: number } = {
  'Vodafone': 3.70, 'RELIANCE - JIO': 0.65, 'Airtel': 1.00, 'BSNL - STV': 3.00, 'BSNL - TOPUP': 3.00, 'Idea': 3.70,
  'DISH TV': 3.80, 'Airtel Digital DTH TV': 4.20, 'SUNDIRECT DTH TV': 3.50, 'VIDEOCON DTH TV': 4.20, 'TATASKY DTH TV': 3.20,
};

const PROVIDERS: any = {
  Prepaid: ['Airtel', 'RELIANCE - JIO', 'Vodafone', 'Idea', 'BSNL - TOPUP', 'BSNL - STV'],
  Postpaid: ['Airtel Postpaid', 'BSNL Postpaid', 'JIO POSTPAID', 'Vodafone Postpaid'],
  DTH: ['Airtel Digital DTH TV', 'DISH TV', 'SUNDIRECT DTH TV', 'TATASKY DTH TV', 'VIDEOCON DTH TV'],
  Electricity: ['Adani power', 'BSES Rajdhani', 'Tata Power', 'TNEB', 'TSNPDCL'],
  Gas: ['Adani Gas', 'Gujarat Gas', 'Indraprastha Gas'],
  Insurance: ['ICICI Prudential', 'Tata AIA'],
  UPI: ['Verify VPA', 'Check Mobile'],
  LPG: ['HP Gas', 'Bharat Gas', 'Indane'],
  Water: ['Hyderabad Water', 'Delhi Jal Board'],
  Broadband: ['Airtel Fiber', 'JioFiber', 'Hathway'],
  EMI: ['Bajaj Finance', 'HDFC Loan'],
  FASTag: ['ICICI Bank', 'Paytm', 'SBI']
};

export default function RechargeScreen() {
  const [activeTab, setActiveTab] = useState('Home'); // 'Home' shows the 12 icons
  const [number, setNumber] = useState('');
  const [operator, setOperator] = useState('');
  const [amount, setAmount] = useState('');

  const numericAmount = parseFloat(amount) || 0;
  const operatorMargin = COMMISSION_RATES[operator] || 0;
  const myProfit = numericAmount * (operatorMargin / 100);
  const customerCoinsEarned = Math.floor(myProfit * 0.80);

  const getInputLabel = () => {
    if (activeTab === 'Electricity') return 'Customer Account :';
    if (activeTab === 'Insurance') return 'Policy Number :';
    if (activeTab === 'DTH') return 'DTH Number :';
    return `${activeTab} Number :`;
  };

  if (activeTab === 'Home') {
    return (
      <ScrollView style={styles.container}>
        <View style={styles.gridContainer}>
          <Text style={styles.sectionTitle}>Recharges & Bill Payments</Text>
          <View style={styles.grid}>
            {SERVICES.map((service) => {
              const IconComp = service.icon;
              return (
                <TouchableOpacity 
                  key={service.id} 
                  style={styles.gridItem}
                  onPress={() => setActiveTab(service.id)}
                >
                  <View style={[styles.iconBox, { backgroundColor: service.color }]}>
                    <IconComp size={24} color={service.iconColor} />
                  </View>
                  <Text style={styles.gridLabel}>{service.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={() => setActiveTab('Home')}>
        <ChevronLeft size={20} color="#6B46C1" />
        <Text style={styles.backText}>Back to Services</Text>
      </TouchableOpacity>

      <View style={styles.formContainer}>
        <View style={styles.header}>
          <Text style={styles.headerText}>{activeTab.toUpperCase()} RECHARGE</Text>
        </View>

        <View style={styles.formBody}>
          <Text style={styles.label}>{getInputLabel()}</Text>
          <TextInput 
            style={styles.input}
            placeholder={`Enter details here`}
            value={number}
            onChangeText={setNumber}
          />

          <Text style={styles.label}>Select Provider :</Text>
          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={operator}
              onValueChange={(val) => setOperator(val)}
            >
              <Picker.Item label="Select Operator*" value="" color="#999" />
              {PROVIDERS[activeTab]?.map((op: string) => (
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
          <Text style={styles.coinText}>Coin rewards will appear when this service is available.</Text>
          )}

          <TouchableOpacity style={styles.button} onPress={() => Alert.alert('Coming soon', 'This service is not connected to a verified provider yet. No payment has been started.')}>
            <Text style={styles.buttonText}>Service unavailable</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9f9f9', padding: 16 },
  // Grid Styles
  gridContainer: { backgroundColor: '#fff', padding: 16, borderRadius: 24, elevation: 2 },
  sectionTitle: { fontSize: 10, fontWeight: '900', color: '#9ca3af', textTransform: 'uppercase', marginBottom: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  gridItem: { width: '25%', alignItems: 'center', marginBottom: 20 },
  iconBox: { width: 56, height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  gridLabel: { fontSize: 9, fontWeight: '700', color: '#374151', textAlign: 'center' },
  // Form Styles
  backButton: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  backText: { color: '#6B46C1', fontWeight: 'bold', marginLeft: 5 },
  formContainer: { backgroundColor: '#fff', borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: '#eee' },
  header: { backgroundColor: '#6B46C1', padding: 20 },
  headerText: { color: '#fff', fontWeight: '900', textAlign: 'center' },
  formBody: { padding: 20 },
  label: { fontWeight: 'bold', color: '#666', marginBottom: 8, marginTop: 10 },
  input: { borderWidth: 1, borderColor: '#eee', borderRadius: 12, padding: 15, backgroundColor: '#fdfdfd' },
  pickerContainer: { borderWidth: 1, borderColor: '#eee', borderRadius: 12, overflow: 'hidden' },
  coinText: { color: '#16a34a', fontWeight: 'bold', marginTop: 10, textAlign: 'center' },
  button: { backgroundColor: '#000', padding: 18, borderRadius: 15, alignItems: 'center', marginTop: 25 },
  buttonText: { color: '#fff', fontWeight: '900', textTransform: 'uppercase' }
});
