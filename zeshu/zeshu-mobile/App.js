import React, { useState, useEffect } from 'react';
import { Text, View, StyleSheet, SafeAreaView, StatusBar, Image, ActivityIndicator, TouchableOpacity, TextInput, Modal, ScrollView, FlatList, Alert, Dimensions, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import Voice from '@react-native-voice/voice';
import RazorpayCheckout from 'react-native-razorpay';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { Picker } from '@react-native-picker/picker';

const { width } = Dimensions.get('window');

let Contacts;
try { Contacts = require('expo-contacts'); } catch (error) { console.warn("expo-contacts module not loaded yet."); }

const API_URL = 'https://zeshu-backend-api.onrender.com/api'; 
const GROCERY_PROFIT_MARGIN = 0.15; 

// --- MASSIVE OPERATORS LIST WITH COMMISSIONS ---
const OPERATORS = {
  Mobile: [
    { n: 'Airtel', c: 1.00, code: 'A' }, { n: 'BSNL - STV', c: 3.00, code: 'BR' },
    { n: 'BSNL - TOPUP', c: 3.00, code: 'BT' }, { n: 'Idea', c: 3.70, code: 'I' },
    { n: 'RELIANCE - JIO', c: 0.65, code: 'RC' }, { n: 'Vodafone', c: 3.70, code: 'V' }
  ],
  Postpaid: [
    { n: 'Airtel Postpaid', c: 0.00, code: 'PAT' }, { n: 'BSNL Postpaid', c: 0.00, code: 'BP' },
    { n: 'Idea Postpaid', c: 0.00, code: 'IP' }, { n: 'JIO POSTPAID', c: 0.00, code: 'JPP' },
    { n: 'Vodafone Postpaid', c: 0.00, code: 'VP' }, { n: 'Airtel Landline', c: 0.00, code: 'LAT' },
    { n: 'Bsnl Landline', c: 0.00, code: 'LBS' }, { n: 'MTNL Delhi Landline', c: 0.00, code: 'LMT' }
  ],
  DTH: [
    { n: 'Airtel Digital DTH TV', c: 4.20, code: 'ATV' }, { n: 'DISH TV', c: 3.80, code: 'DTV' }, 
    { n: 'SUNDIRECT DTH TV', c: 3.50, code: 'STVDT' }, { n: 'TATASKY DTH TV', c: 3.20, code: 'TTV' },
    { n: 'VIDEOCON DTH TV', c: 4.20, code: 'VTV' }
  ],
  Electricity: [
    { n: 'Adani power', c: 0.00, code: 'AEML' }, { n: 'Ajmer Vidyut Vitran Nigam', c: 0.00, code: 'AJV' },
    { n: 'APDCL (Non-RAPDR) ASSAM', c: 0.00, code: 'APDCLN' }, { n: 'APEPDCL ANDHRA PRADESH', c: 0.00, code: 'APEPDCL' },
    { n: 'Assam Power (RAPDR)', c: 0.00, code: 'APDCLR' }, { n: 'Bangalore Electricity', c: 0.00, code: 'BESCOM' },
    { n: 'BEST Mumbai', c: 0.00, code: 'BEST' }, { n: 'BSES Rajdhani Delhi', c: 0.00, code: 'BSES' },
    { n: 'BSES Yamuna Delhi', c: 0.00, code: 'BSESY' }, { n: 'CESC WEST BENGAL', c: 0.00, code: 'CESC' },
    { n: 'Chhattisgarh State Power', c: 0.00, code: 'CSPDCL' }, { n: 'Dakshin Haryana Bijli', c: 0.00, code: 'DHBVN' },
    { n: 'Jaipur Vidyut Vitran', c: 0.00, code: 'JVV' }, { n: 'Kerala State Electricity', c: 0.00, code: 'KSEB' },
    { n: 'MSEDC MAHARASHTRA', c: 0.00, code: 'MSEDC' }, { n: 'Punjab State Power', c: 0.00, code: 'PSPCL' },
    { n: 'Tata Power MUMBAI', c: 0.00, code: 'TPDM' }, { n: 'TNEB TAMIL NADU', c: 0.00, code: 'TNEB' },
    { n: 'TSNPDCL Telangana', c: 0.00, code: 'TSNPDCL' }, { n: 'UPPCL (URBAN)', c: 0.00, code: 'UPPCLU' },
    { n: 'Uttar Pradesh Power (Rural)', c: 0.00, code: 'UPPCLR' }, { n: 'NESCO Odisha', c: 0.00, code: 'NESCO' },
    { n: 'Southern Power TELANGANA', c: 0.00, code: 'TSSPDCL' }, { n: 'WBSEDCL WEST BENGAL', c: 0.00, code: 'WBSEDCL' }
  ],
  Gas: [
    { n: 'Adani Gas', c: 0.00, code: 'AGGas' }, { n: 'Gujarat Gas', c: 0.00, code: 'GGGas' },
    { n: 'Hindustan Petroleum', c: 0.00, code: 'HPCLGCGas' }, { n: 'Indraprastha Gas', c: 0.00, code: 'IGGas' },
    { n: 'Mahanagar Gas', c: 0.00, code: 'MGGas' }
  ],
  Insurance: [
    { n: 'ICICI Prudential Insurance', c: 0.00, code: 'ICPInsurance' }, 
    { n: 'Tata AIA Insurance', c: 0.00, code: 'TAIInsurance' }
  ],
  FASTag: [
    { n: 'Federal Bank', c: 0.15, code: 'FDF' }, { n: 'Hdfc Bank', c: 0.15, code: 'HDF' }, 
    { n: 'Icici Bank', c: 0.15, code: 'ICF' }, { n: 'Paytm Bank', c: 0.15, code: 'PTF' },
    { n: 'Axis Bank', c: 0.15, code: 'AXF' }, { n: 'Sbi Bank', c: 0.15, code: 'SBF' },
    { n: 'Bank Of Baroda', c: 0.15, code: 'BOB' }
  ],
  PlayStore: [
    { n: 'Google Play', c: 2.50, code: 'GPR' },
    { n: 'Airtel Payments Bank', c: 0.15, code: 'APB' }
  ]
};

// PHONEPE STYLE ICON GRID WIDGET
const PhonePeIcon = ({ name, icon, onPress }) => (
  <TouchableOpacity style={styles.ppIconContainer} onPress={onPress}>
    <View style={styles.ppCircle}>
      <Ionicons name={icon} size={28} color="#5f259f" />
    </View>
    <Text style={styles.ppLabel} numberOfLines={2}>{name}</Text>
  </TouchableOpacity>
);

// --- HOME SCREEN ---
function HomeScreen({ navigation }) {
  const [products, setProducts] = useState([]);
  const [filteredProducts, setFilteredProducts] = useState([]);
  const [cart, setCart] = useState({});
  const [isCartVisible, setIsCartVisible] = useState(false);
  const [coinBalance, setCoinBalance] = useState(150);
  const [isUsingCoins, setIsUsingCoins] = useState(false);
  
  // Recharge States
  const [isRechargeVisible, setIsRechargeVisible] = useState(false);
  const [rechargeType, setRechargeType] = useState('Mobile');
  const [selectedCat, setSelectedCat] = useState('Mobile');
  const [rechargeForm, setRechargeForm] = useState({ number: '', amount: '', operator: null, dob: '' });
  
  // Grocery States
  const [locationName, setLocationName] = useState('Jagtial, Telangana, India');
  const [isLocationModalVisible, setIsLocationModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [activeCategory, setActiveCategory] = useState('All');

  useEffect(() => {
    // Mock Groceries loading (Replace with your actual fetch)
    const mockProducts = [
        { id: 1, name: "Vegetables & Fruits", price: 149, image_url: "https://cdn-icons-png.flaticon.com/512/3194/3194591.png", unit: "1 kg" },
        { id: 2, name: "Atta, Rice & Dal", price: 299, image_url: "https://cdn-icons-png.flaticon.com/512/5753/5753696.png", unit: "5 kg" },
    ];
    setProducts(mockProducts); setFilteredProducts(mockProducts);
  }, []);

  // --- ZESHU COINS: GROCERY LOGIC (60% of Profit) ---
  const itemsTotal = Object.values(cart).reduce((s, i) => s + (i.price * i.quantity), 0);
  const cartItemCount = Object.values(cart).reduce((s, i) => s + i.quantity, 0);
  const earnedCoinsGrocery = Math.floor((itemsTotal * GROCERY_PROFIT_MARGIN) * 0.60);

  const addToCart = (p) => setCart(prev => ({ ...prev, [p.id]: prev[p.id] ? { ...p, quantity: prev[p.id].quantity + 1 } : { ...p, quantity: 1 } }));

  // --- SECURE RECHARGE PROCESSING ---
  const processRecharge = async () => {
    if (!global.currentUser) return Alert.alert("Login Required", "Please login first.");
    if (!rechargeForm.operator || !rechargeForm.amount || !rechargeForm.number) return alert("Fill all details");
    
    const amount = parseInt(rechargeForm.amount);
    const op = rechargeForm.operator;
    
    // ZESHU COINS: RECHARGE LOGIC (80% of Commission)
    const userCoinReward = op.c > 0 ? Math.floor((amount * (op.c / 100)) * 0.80) : 0;
    const useCoinAmt = isUsingCoins ? Math.min(coinBalance, amount) : 0;
    
    try {
       const response = await fetch(`${API_URL}/recharge`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
           operator_code: op.code,
           number: rechargeForm.number,
           amount: amount,
           order_id: Math.floor(Math.random() * 1000000).toString(),
           dob: rechargeForm.dob || null
         })
       });
       
       const json = await response.json();
       if (json.status === 'Success') {
          setCoinBalance(prev => prev - useCoinAmt + userCoinReward);
          setIsRechargeVisible(false);
          if (userCoinReward > 0) {
            Alert.alert("Success", `Recharge Successful! You earned 🪙 ${userCoinReward} Zeshu Coins!`);
          } else {
            Alert.alert("Success", `Bill Payment Processed Successfully!`);
          }
       } else {
          Alert.alert("Failed", json.message || "Error processing transaction.");
       }
    } catch (error) {
       Alert.alert("Server Error", "Could not connect to Zeshu backend.");
    }
  };

  const openRechargeModal = (cat, title) => {
    setSelectedCat(cat);
    setRechargeType(title);
    setRechargeForm({ number: '', amount: '', operator: null, dob: '' });
    setIsRechargeVisible(true);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAFAFB" />
      
      {/* BLINKIT STYLE HEADER (Preserved) */}
      <View style={styles.blinkitHeader}>
        <View style={{flex: 1}}>
            <Text style={{fontSize: 12, fontWeight: 'bold', color: '#FF007F'}}>Zeshu in</Text>
            <View style={{flexDirection: 'row', alignItems: 'center'}}>
                <Text style={{fontSize: 24, fontWeight: '900', color: '#111'}}>22 minutes</Text>
            </View>
        </View>
        <View style={{flexDirection: 'row', alignItems: 'center'}}>
            <View style={styles.walletPill}>
                <Ionicons name="wallet" size={16} color="#F4B400" />
                <Text style={{fontWeight: 'bold', color: '#FFF', marginLeft: 5}}>₹{coinBalance}</Text>
            </View>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{paddingBottom: 100}}>
        
        {/* --- NEW PHONEPE STYLE BILLS SECTION --- */}
        <View style={styles.ppCard}>
          <View style={styles.ppCardHeader}>
            <Text style={styles.ppCardTitle}>Recharge & Pay Bills</Text>
            <View style={styles.ppBadge}><Text style={styles.ppBadgeText}>Earn Coins!</Text></View>
          </View>
          
          <View style={styles.ppGrid}>
            <PhonePeIcon name="Mobile" icon="phone-portrait" onPress={() => openRechargeModal('Mobile', 'Mobile Recharge')} />
            <PhonePeIcon name="Postpaid" icon="document-text" onPress={() => openRechargeModal('Postpaid', 'Postpaid Bill')} />
            <PhonePeIcon name="DTH" icon="tv" onPress={() => openRechargeModal('DTH', 'DTH Recharge')} />
            <PhonePeIcon name="Electricity" icon="bulb" onPress={() => openRechargeModal('Electricity', 'Electricity Bill')} />
            <PhonePeIcon name="FASTag" icon="car" onPress={() => openRechargeModal('FASTag', 'FASTag Recharge')} />
            <PhonePeIcon name="Gas" icon="flame" onPress={() => openRechargeModal('Gas', 'Gas Bill')} />
            <PhonePeIcon name="Insurance" icon="shield-checkmark" onPress={() => openRechargeModal('Insurance', 'Insurance Premium')} />
            <PhonePeIcon name="Google Play" icon="logo-google-playstore" onPress={() => openRechargeModal('PlayStore', 'Google Play Code')} />
          </View>
        </View>

        {/* BLINKIT GROCERY GRID (Preserved) */}
        <Text style={styles.sectionHeading}>Grocery & Kitchen</Text>
        <View style={styles.gridContainer}>
          {filteredProducts.map(item => (
            <View key={item.id} style={styles.gridCard}>
              <View style={styles.gridImgBox}>
                 <Image source={{uri: item.image_url}} style={styles.gridImg} />
                 <TouchableOpacity style={styles.gridAddBtn} onPress={() => addToCart(item)}><Text style={styles.gridAddText}>ADD</Text></TouchableOpacity>
              </View>
              <Text style={styles.gridProdName} numberOfLines={2}>{item.name}</Text>
              <Text style={styles.gridProdPrice}>₹{item.price}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* FLOATING CART (Preserved) */}
      {cartItemCount > 0 && (
         <View style={styles.floatingCartContainer}>
            <TouchableOpacity style={styles.floatingCartBtn} onPress={() => setIsCartVisible(true)}>
                <View style={{flexDirection: 'row', alignItems: 'center'}}>
                    <Ionicons name="cart" size={24} color="#FFF" />
                    <View style={{marginLeft: 10}}>
                        <Text style={{color: '#FFF', fontWeight: 'bold', fontSize: 14}}>{cartItemCount} items</Text>
                        <Text style={{color: '#E0E0E0', fontSize: 12}}>Earn 🪙 {earnedCoinsGrocery} Coins!</Text>
                    </View>
                </View>
                <Text style={{color: '#FFF', fontWeight: 'bold'}}>View Cart ➔</Text>
            </TouchableOpacity>
         </View>
      )}

      {/* --- NEW PHONEPE STYLE RECHARGE MODAL --- */}
      <Modal visible={isRechargeVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.ppModalContent}>
            
            <View style={styles.ppModalHeader}>
              <TouchableOpacity onPress={() => setIsRechargeVisible(false)}><Ionicons name="arrow-back" size={24} color="#FFF" /></TouchableOpacity>
              <Text style={styles.ppModalTitle}>{rechargeType.toUpperCase()}</Text>
            </View>

            <ScrollView style={{padding: 20}}>
              
              <Text style={styles.ppFormLabel}>Select Provider</Text>
              <View style={styles.pickerContainer}>
                <Picker
                  selectedValue={rechargeForm.operator?.n}
                  onValueChange={(itemValue) => {
                    const selectedOp = OPERATORS[selectedCat].find(o => o.n === itemValue);
                    setRechargeForm({...rechargeForm, operator: selectedOp});
                  }}
                  style={{color: '#333'}}
                >
                  <Picker.Item label="Tap to select operator" value="" color="#888" />
                  {OPERATORS[selectedCat]?.map(op => (
                    <Picker.Item key={op.code} label={op.n} value={op.n} />
                  ))}
                </Picker>
              </View>

              {rechargeForm.operator && rechargeForm.operator.c > 0 && (
                <Text style={styles.ppCommissionHint}>🪙 Earn up to {Math.floor(rechargeForm.operator.c * 0.80)}% Zeshu Coins</Text>
              )}

              <Text style={styles.ppFormLabel}>
                {selectedCat === 'Electricity' ? 'Customer Account Number' : selectedCat === 'FASTag' ? 'Vehicle Number' : 'Mobile / Account Number'}
              </Text>
              <TextInput 
                style={styles.ppInput} 
                placeholder="Enter details here" 
                value={rechargeForm.number}
                onChangeText={(t) => setRechargeForm({...rechargeForm, number: t})}
              />

              {selectedCat === 'Insurance' && (
                <>
                  <Text style={styles.ppFormLabel}>Date of Birth</Text>
                  <TextInput 
                    style={styles.ppInput} 
                    placeholder="DD-MM-YYYY" 
                    value={rechargeForm.dob} 
                    onChangeText={(t) => setRechargeForm({...rechargeForm, dob: t})} 
                  />
                </>
              )}

              <Text style={styles.ppFormLabel}>Amount (₹)</Text>
              <TextInput 
                style={[styles.ppInput, {fontSize: 22, fontWeight: 'bold'}]} 
                placeholder="₹0" 
                keyboardType="numeric"
                value={rechargeForm.amount}
                onChangeText={(t) => setRechargeForm({...rechargeForm, amount: t})}
              />

              {/* DYNAMIC COIN DISPLAY */}
              {rechargeForm.amount !== '' && rechargeForm.operator && rechargeForm.operator.c > 0 && (
                <View style={styles.ppRewardBox}>
                  <Text style={styles.ppRewardText}>🎉 You will earn {Math.floor(parseInt(rechargeForm.amount) * (rechargeForm.operator.c / 100) * 0.80)} Zeshu Coins!</Text>
                </View>
              )}

              <TouchableOpacity style={styles.ppPayBtn} onPress={processRecharge}>
                <Text style={styles.ppPayBtnText}>PROCEED TO PAY</Text>
              </TouchableOpacity>
              
            </ScrollView>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

// --- APP SETUP ---
const Tab = createBottomTabNavigator();
global.currentUser = { email: "user@zeshu.com" }; // Mock Auth

export default function App() {
  return (
    <NavigationContainer>
      <Tab.Navigator screenOptions={{ tabBarActiveTintColor: '#FF007F', headerShown: false }}>
        <Tab.Screen name="Home" component={HomeScreen} options={{tabBarIcon: ({color}) => <Ionicons name="home" size={24} color={color}/>}} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

// --- STYLES ---
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F6F8' }, 
  blinkitHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: 15, paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight + 10 : 20, backgroundColor: '#F4F6F8' },
  walletPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  sectionHeading: { fontSize: 16, fontWeight: 'bold', marginHorizontal: 15, marginBottom: 15, color: '#111', marginTop: 20 },
  
  // GROCERY STYLES (Preserved)
  gridContainer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 15 },
  gridCard: { width: '48%', backgroundColor: '#FFF', borderRadius: 12, padding: 10, marginBottom: 15, elevation: 1 },
  gridImgBox: { position: 'relative', alignItems: 'center', marginBottom: 10 },
  gridImg: { width: 90, height: 90, resizeMode: 'contain' },
  gridAddBtn: { position: 'absolute', bottom: -10, right: -5, backgroundColor: '#FFF', paddingHorizontal: 15, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: '#0C831F', elevation: 2 },
  gridAddText: { color: '#0C831F', fontWeight: 'bold', fontSize: 12 },
  gridProdName: { fontSize: 12, fontWeight: '600', color: '#333', height: 32 },
  gridProdPrice: { fontSize: 14, fontWeight: 'bold', color: '#111', marginTop: 10 },
  
  floatingCartContainer: { position: 'absolute', bottom: 15, left: 0, right: 0, alignItems: 'center' },
  floatingCartBtn: { backgroundColor: '#0C831F', width: '92%', borderRadius: 12, padding: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', elevation: 5 },

  // --- NEW PHONEPE STYLES ---
  ppCard: { backgroundColor: '#FFF', margin: 15, borderRadius: 16, padding: 15, elevation: 4, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.1, shadowRadius: 6 },
  ppCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, borderBottomWidth: 1, borderBottomColor: '#f0f0f0', paddingBottom: 10 },
  ppCardTitle: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  ppBadge: { backgroundColor: '#e8f5e9', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  ppBadgeText: { color: '#2e7d32', fontSize: 10, fontWeight: 'bold' },
  
  ppGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  ppIconContainer: { width: '23%', alignItems: 'center', marginBottom: 20 },
  ppCircle: { width: 50, height: 50, borderRadius: 16, backgroundColor: '#f3e5f5', justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  ppLabel: { fontSize: 11, color: '#444', textAlign: 'center', fontWeight: '500' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  ppModalContent: { backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, height: '85%' },
  ppModalHeader: { backgroundColor: '#5f259f', padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24, flexDirection: 'row', alignItems: 'center' },
  ppModalTitle: { color: '#FFF', fontSize: 18, fontWeight: 'bold', marginLeft: 15, letterSpacing: 0.5 },
  
  ppFormLabel: { fontSize: 13, fontWeight: 'bold', color: '#666', marginTop: 20, marginBottom: 5, textTransform: 'uppercase' },
  ppInput: { borderBottomWidth: 2, borderBottomColor: '#ddd', fontSize: 18, color: '#333', paddingVertical: 8, fontWeight: '500' },
  pickerContainer: { borderBottomWidth: 2, borderBottomColor: '#ddd', marginTop: 5 },
  
  ppCommissionHint: { fontSize: 12, color: '#0C831F', fontWeight: 'bold', marginTop: 5 },
  ppRewardBox: { backgroundColor: '#e8f5e9', padding: 12, borderRadius: 8, marginTop: 20, borderWidth: 1, borderColor: '#c8e6c9' },
  ppRewardText: { color: '#2e7d32', fontWeight: 'bold', textAlign: 'center', fontSize: 13 },
  
  ppPayBtn: { backgroundColor: '#5f259f', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 30, elevation: 3 },
  ppPayBtnText: { color: '#FFF', fontSize: 16, fontWeight: 'bold', letterSpacing: 1 }
});