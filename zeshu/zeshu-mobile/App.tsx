import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  StyleSheet, Text, View, ScrollView, TouchableOpacity, 
  Image, TextInput, Modal, SafeAreaView, StatusBar, Dimensions, Alert, Platform, ActivityIndicator
} from 'react-native';
import { Ionicons, MaterialCommunityIcons, FontAwesome5 } from '@expo/vector-icons';
import * as Location from 'expo-location'; 
import RazorpayCheckout from 'react-native-razorpay'; 
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Picker } from '@react-native-picker/picker'; 
import { CameraView, useCameraPermissions } from 'expo-camera'; 

// Database Connection
import { supabase } from './supabase'; 

const BASE_URL = 'https://www.zeshu.in';

const { width, height } = Dimensions.get('window');
const Stack = createNativeStackNavigator();

// --- MODERN UTILITY THEME ---
const PRIMARY_COLOR = '#8A2BE2'; 
const ACCENT_COLOR = '#00FF7F';  
const TEXT_DARK = '#111827';
const TEXT_MUTED = '#6B7280';
const ZESHU_LOGO_URL = 'https://ui-avatars.com/api/?name=Z&background=8A2BE2&color=fff&rounded=true&bold=true&size=128';

const FALLBACK_PRODUCTS = [
  { id: 1, name: 'Cadbury Dairy Milk Milkinis Milk Chocolate Bar', price: 36, unit: '34 g', image_url: 'https://m.media-amazon.com/images/I/61+y5S5C-kL.jpg' },
  { id: 2, name: 'Amul Taaza Toned Fresh Milk', price: 54, unit: '1 l', image_url: 'https://m.media-amazon.com/images/I/61+y5S5C-kL.jpg' },
  { id: 3, name: 'Aashirvaad Shudh Chakki Atta', price: 215, unit: '5 kg', image_url: 'https://m.media-amazon.com/images/I/71rI1D8O7-L.jpg' },
  { id: 4, name: 'Fortune Sunlite Refined Oil', price: 145, unit: '1 l', image_url: 'https://m.media-amazon.com/images/I/61KxV+R0rAL.jpg' }
];

const PROVIDERS = {
  Mobile: ['Airtel', 'JIO', 'Vodafone', 'BSNL'],
  Postpaid: ['Airtel Postpaid', 'BSNL Postpaid', 'JIO Postpaid', 'Vodafone Postpaid'],
  Electricity: ['Adani Power', 'BSES', 'Tata Power', 'TNEB', 'TSNPDCL'],
};

// Operator OP Codes for Vercel Backend Mapping
const OPERATORS_DATA = {
  Mobile: { 'JIO': '11', 'Airtel': '2', 'Vodafone': '23', 'BSNL': '4' },
  Electricity: { 'TSNPDCL': '475', 'Adani Power': '50', 'BSES': '449', 'Tata Power': '116', 'TNEB': '115' },
};

const COMMISSION_RATES = {
  'Airtel': 1.00, 'JIO': 0.65, 'Vodafone': 3.70, 'BSNL': 3.00,
  'Airtel Postpaid': 1.00, 'JIO Postpaid': 0.65, 'Vodafone Postpaid': 3.70, 'BSNL Postpaid': 3.00,
  'Adani Power': 0.50, 'BSES': 0.50, 'Tata Power': 0.50, 'TNEB': 0.50, 'TSNPDCL': 0.50
};

// ==========================================
// SCREEN 1: HOME SCREEN
// ==========================================
function HomeScreen({ navigation }) {
  const scrollViewRef = useRef(null); 

  const [products, setProducts] = useState([]);
  const [searchQuery, setSearchQuery] = useState(''); 
  const [cart, setCart] = useState([]);
  
  const [isLoggedIn, setIsLoggedIn] = useState(false); 
  const [userId, setUserId] = useState(null);
  const [coinsBalance, setCoinsBalance] = useState(0);
  
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [isCoinHistoryOpen, setIsCoinHistoryOpen] = useState(false); 
  
  const [loginStep, setLoginStep] = useState('phone'); 
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(false);

  const [isCartOpen, setIsCartOpen] = useState(false);
  const [useZeshuCoins, setUseZeshuCoins] = useState(false);
  const [tipAmount, setTipAmount] = useState(20); 
  const [isDonating, setIsDonating] = useState(true); 
  const [currentAddress, setCurrentAddress] = useState('HotelRoom 205, 2nd floor Shree Amardeep...');
  const [isDetectingLoc, setIsDetectingLoc] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);

  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannedPayee, setScannedPayee] = useState(null);
  const [scanAmount, setScanAmount] = useState('');
  const [permission, requestPermission] = useCameraPermissions();

  const [myOrders, setMyOrders] = useState([]);

  const ZESHU_COINS_VAL = 50;
  const HANDLING_FEE = 5;

  useEffect(() => {
    const fetchProducts = async () => {
      const { data } = await supabase.from('products').select('*');
      if (data && data.length > 0) setProducts(data);
      else setProducts(FALLBACK_PRODUCTS);
    };
    fetchProducts();
    checkUser();
  }, []);

  const checkUser = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      setUserId(session.user.id);
      setIsLoggedIn(true);
      fetchCoinBalance(session.user.id);
    }
  };

  const fetchCoinBalance = async (uid) => {
    const { data } = await supabase.from('wallets').select('coins').eq('user_id', uid).single();
    if (data) setCoinsBalance(data.coins);
  };

  // Real-time Tracker
  useEffect(() => {
    if (!userId) { setMyOrders([]); return; }
    
    const fetchOrders = async () => {
      const { data } = await supabase.from('orders').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1);
      if (data) setMyOrders(data);
    };
    fetchOrders();

    const channel = supabase.channel('customer-mobile-tracker')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `user_id=eq.${userId}` }, 
      (payload) => setMyOrders([payload.new]))
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleAutoDetectLocation = async () => {
    setIsDetectingLoc(true);
    let { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Allow location access for Real-time Geocoding.');
      setIsDetectingLoc(false);
      return;
    }
    try {
      let location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      let addressArray = await Location.reverseGeocodeAsync(location.coords);
      if (addressArray && addressArray.length > 0) {
        const loc = addressArray[0];
        setCurrentAddress(`${loc.name || loc.street}, ${loc.city}, ${loc.region}`);
      }
    } catch (error) {
      Alert.alert('GIS Error', 'Could not sync with Spatial Database.');
    }
    setIsDetectingLoc(false);
  };

  const handleProfileClick = () => {
    if (isLoggedIn) setIsAccountOpen(true);
    else { setShowLoginModal(true); setLoginStep('phone'); setPhoneNumber(''); setOtp(''); }
  };

  const handleSendOTP = async () => {
    if (phoneNumber.length < 10) return Alert.alert("Invalid", "Enter 10-digit number.");
    setIsAuthLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ phone: `+91${phoneNumber}` });
    setIsAuthLoading(false);
    
    if (!error) setLoginStep('otp');
    else Alert.alert("Error", error.message);
  };

  const handleVerifyOTP = async () => {
    if (otp.length < 4) return;
    setIsAuthLoading(true);
    const { data, error } = await supabase.auth.verifyOtp({ phone: `+91${phoneNumber}`, token: otp, type: 'sms' });
    setIsAuthLoading(false);

    if (data.session) {
      setUserId(data.session.user.id);
      setIsLoggedIn(true);
      setShowLoginModal(false);
      fetchCoinBalance(data.session.user.id);
    } else {
      Alert.alert("Error", error?.message || "Invalid OTP");
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsLoggedIn(false); setUserId(null); setCoinsBalance(0); setIsAccountOpen(false);
    Alert.alert("Logged Out", "You have been successfully logged out.");
  };

  const addToCart = (product) => {
    const existing = cart.find(c => c.item.id === product.id);
    if (existing) setCart(cart.map(c => c.item.id === product.id ? { ...c, qty: c.qty + 1 } : c));
    else setCart([...cart, { item: product, qty: 1 }]);
  };

  const removeFromCart = (productId) => {
    const existing = cart.find(c => c.item.id === productId);
    if (existing && existing.qty > 1) {
      setCart(cart.map(c => c.item.id === productId ? { ...c, qty: c.qty - 1 } : c));
    } else {
      setCart(cart.filter(c => c.item.id !== productId));
      if (cart.length === 1) setIsCartOpen(false);
    }
  };

  const parseUpiData = (qrString) => {
    if (!qrString.startsWith('upi://pay')) return null;
    try {
      const paMatch = qrString.match(/pa=([^&]+)/);
      const pnMatch = qrString.match(/pn=([^&]+)/);
      const amMatch = qrString.match(/am=([^&]+)/);
      
      if(paMatch) {
        return { 
          payeeAddress: paMatch[1], 
          payeeName: pnMatch ? decodeURIComponent(pnMatch[1]) : 'Merchant', 
          amount: amMatch ? amMatch[1] : '' 
        };
      }
      return null;
    } catch (error) { return null; }
  };

  const itemTotal = cart.reduce((acc, curr) => acc + (curr.item.price * curr.qty), 0);
  const smallCartCharge = (itemTotal > 0 && itemTotal < 100) ? 20 : 0;
  const deliveryCharge = (itemTotal > 0 && itemTotal < 200) ? 30 : 0; 
  const donationAmt = isDonating ? 1 : 0;
  const zeshuDiscount = useZeshuCoins ? Math.min(ZESHU_COINS_VAL, itemTotal) : 0; 
  const finalTotal = itemTotal > 0 ? (itemTotal + smallCartCharge + deliveryCharge + HANDLING_FEE + donationAmt + tipAmount - zeshuDiscount) : 0;

  // 🚀 HARDENED RAZORPAY CHECKOUT
  const handleCheckout = async () => {
    if (finalTotal === 0) return;
    if (!isLoggedIn || !userId) { setIsCartOpen(false); handleProfileClick(); return; }

    setIsCheckingOut(true);
    
    try {
      const orderResponse = await fetch(`${BASE_URL}/api/create-razorpay-order`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: finalTotal })
      });
      
      const textRes = await orderResponse.text();
      let orderData;
      try { orderData = JSON.parse(textRes); } catch(e) { Alert.alert('Server Error', `Invalid response from backend.`); setIsCheckingOut(false); return; }

      const orderId = orderData.id || (orderData.order && orderData.order.id);
      if (!orderId) { Alert.alert('Checkout Error', `Could not fetch Order ID.`); setIsCheckingOut(false); return; }

      var options = {
        description: 'Zeshu Super App Groceries',
        image: ZESHU_LOGO_URL,
        currency: orderData.currency || (orderData.order && orderData.order.currency) || 'INR',
        key: process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID || 'rzp_test_SZhZ5NLWfFtlJZ', // Safe fallback
        amount: orderData.amount || (orderData.order && orderData.order.amount) || (finalTotal * 100),
        order_id: orderId, 
        name: 'ZESHU SUPER APP',
        prefill: { email: 'customer@zeshu.in', contact: '9999999999', name: 'Zeshu User' },
        theme: { color: PRIMARY_COLOR }
      };

      RazorpayCheckout.open(options).then(async (data) => {
        try {
          await fetch(`${BASE_URL}/api/confirm-grocery-order`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: userId,
              cartItems: cart,
              totalAmount: finalTotal,
              paymentId: data.razorpay_payment_id,
              address: currentAddress
            })
          });
        } catch (e) { console.log("Backend sync error", e); }

        Alert.alert('Payment Successful!', `Your groceries are being packed!`);
        setCart([]); 
        setIsCartOpen(false);
      }).catch((error) => {
        Alert.alert('Payment Failed', error.description || error.error?.description || 'Checkout was cancelled.');
      });
    } catch (err) {
      Alert.alert('Network Error', 'Could not reach Zeshu servers.');
    } finally {
      setIsCheckingOut(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" translucent={true} />
      
      {/* HEADER */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity style={styles.logoContainer} onPress={() => scrollViewRef.current?.scrollTo({y: 0, animated: true})}>
            <Image source={{ uri: ZESHU_LOGO_URL }} style={styles.logoImage} />
            <View>
              <Text style={[styles.logoText, {color: PRIMARY_COLOR}]}>ZESHU</Text>
              <Text style={styles.subLogoText}>SUPER APP</Text>
            </View>
          </TouchableOpacity>
          <View style={styles.headerActions}>
            <TouchableOpacity style={[styles.userIcon, {backgroundColor: PRIMARY_COLOR, padding: 6}]} onPress={async () => {
              if (!permission?.granted) await requestPermission();
              setIsScannerOpen(true);
            }}>
              <Ionicons name="qr-code" size={18} color="white" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.coinsPill} onPress={() => setIsCoinHistoryOpen(true)}>
              <FontAwesome5 name="coins" size={12} color="#F59E0B" />
              <Text style={styles.coinsText}>{coinsBalance}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleProfileClick} style={styles.userIcon}>
              <Ionicons name="person" size={20} color={isLoggedIn ? PRIMARY_COLOR : "#9CA3AF"} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.locationContainer}>
          <TouchableOpacity style={styles.locationBox}>
            <Text style={styles.deliveryText}>Delivery in 20 minutes</Text>
            <View style={{flexDirection: 'row', alignItems: 'center'}}>
              <Text style={styles.addressText} numberOfLines={1}>{currentAddress}</Text>
              <Ionicons name="chevron-down" size={14} color={TEXT_MUTED} style={{marginLeft: 4}}/>
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.autoDetectBtn} onPress={handleAutoDetectLocation}>
            {isDetectingLoc ? <ActivityIndicator size="small" color={PRIMARY_COLOR} /> : <Text style={[styles.autoDetectText, {color: PRIMARY_COLOR}]}>Auto Detect</Text>}
          </TouchableOpacity>
        </View>

        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color={TEXT_MUTED} />
          <TextInput 
            style={styles.searchInput} 
            placeholder="Search 'milk' or 'recharge'..." 
            placeholderTextColor="#9CA3AF" 
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          <TouchableOpacity><Ionicons name="mic" size={22} color={PRIMARY_COLOR} /></TouchableOpacity>
        </View>
      </View>

      <ScrollView ref={scrollViewRef} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 150 }}>
        
        {/* LIVE ORDER TRACKER */}
        {myOrders.length > 0 && myOrders[0].status !== 'DELIVERED' && (
          <View style={{ backgroundColor: '#fff', padding: 20, margin: 16, borderRadius: 24, borderWidth: 1, borderColor: '#e9d5ff', elevation: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ fontSize: 14, fontWeight: '900', color: PRIMARY_COLOR, textTransform: 'uppercase' }}>Live Tracking</Text>
              <View style={{ backgroundColor: '#f3e8ff', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 }}><Text style={{ fontSize: 10, fontWeight: '900', color: PRIMARY_COLOR }}>#{myOrders[0].id.split('-')[0].toUpperCase()}</Text></View>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ width: '100%', height: 4, backgroundColor: '#f1f5f9', position: 'absolute', top: 20, zIndex: 0 }} />
              <View style={{ alignItems: 'center', zIndex: 1 }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: PRIMARY_COLOR, justifyContent: 'center', alignItems: 'center' }}><Ionicons name="time" size={16} color="#fff"/></View>
                <Text style={{ fontSize: 10, fontWeight: '800', marginTop: 8, color: '#64748b' }}>PACKING</Text>
              </View>
              <View style={{ alignItems: 'center', zIndex: 1 }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: myOrders[0].status === 'OUT_FOR_DELIVERY' ? PRIMARY_COLOR : '#fff', borderWidth: 2, borderColor: myOrders[0].status === 'OUT_FOR_DELIVERY' ? PRIMARY_COLOR : '#e2e8f0', justifyContent: 'center', alignItems: 'center' }}><Ionicons name="car" size={16} color={myOrders[0].status === 'OUT_FOR_DELIVERY' ? '#fff' : '#94a3b8'}/></View>
                <Text style={{ fontSize: 10, fontWeight: '800', marginTop: 8, color: '#64748b' }}>ON THE WAY</Text>
              </View>
              <View style={{ alignItems: 'center', zIndex: 1 }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', borderWidth: 2, borderColor: '#e2e8f0', justifyContent: 'center', alignItems: 'center' }}><Ionicons name="checkmark-circle" size={16} color="#94a3b8"/></View>
                <Text style={{ fontSize: 10, fontWeight: '800', marginTop: 8, color: '#64748b' }}>ARRIVED</Text>
              </View>
            </View>
          </View>
        )}

        {searchQuery === '' && (
          <View style={styles.phonePeCard}>
            <Text style={styles.sectionTitle}>BILLS & RECHARGES</Text>
            <View style={styles.rechargeGrid}>
              {[
                { n: 'Mobile', i: 'cellphone' }, { n: 'Postpaid', i: 'phone-check' }, 
                { n: 'DTH', i: 'television-classic' }, { n: 'UPI Tools', i: 'bank-transfer' }, 
                { n: 'FASTag', i: 'car-connected' }, { n: 'Electricity', i: 'flash' }, 
                { n: 'Piped Gas', i: 'fire' }, { n: 'LPG Booking', i: 'gas-cylinder' }, 
                { n: 'Water', i: 'water' }, { n: 'Broadband', i: 'wifi' }, 
                { n: 'Loan EMI', i: 'bank' }, { n: 'Insurance', i: 'shield-check' }
              ].map((item, idx) => (
                <TouchableOpacity key={idx} style={styles.gridItem} onPress={() => navigation.navigate('Recharge', { service: item.n })}>
                  <View style={styles.gridIcon}><MaterialCommunityIcons name={item.i} size={28} color={PRIMARY_COLOR} /></View>
                  <Text style={styles.gridLabel}>{item.n}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Grocery & Kitchen</Text>
          
          {products.length === 0 && searchQuery === '' ? (
            <ActivityIndicator size="large" color={PRIMARY_COLOR} style={{ marginTop: 30 }} />
          ) : filteredProducts.length === 0 ? (
            <Text style={{color: TEXT_MUTED, marginTop: 10}}>No products found matching "{searchQuery}"</Text>
          ) : (
            <View style={styles.productGrid}>
              {filteredProducts.map((p) => {
                const inCart = cart.find(c => c.item.id === p.id);
                return (
                  <View key={p.id} style={styles.productCard}>
                    <View style={styles.imageContainer}>
                      <View style={styles.etaBadge}><Text style={styles.etaText}>12 MINS</Text></View>
                      <Image source={{ uri: p.image_url }} style={styles.productImage} resizeMode="contain" />
                    </View>
                    <Text style={styles.unitText}>{p.weight || p.unit || 'N/A'}</Text>
                    <Text style={styles.productName} numberOfLines={2}>{p.name}</Text>
                    <View style={styles.priceRow}>
                      <Text style={styles.priceText}>₹{p.price}</Text>
                      {inCart ? (
                        <View style={[styles.qtyBox, {backgroundColor: ACCENT_COLOR}]}>
                          <TouchableOpacity onPress={() => removeFromCart(p.id)} style={styles.qtyBtn}><Ionicons name="remove" size={16} color={TEXT_DARK} /></TouchableOpacity>
                          <Text style={[styles.qtyText, {color: TEXT_DARK}]}>{inCart.qty}</Text>
                          <TouchableOpacity onPress={() => addToCart(p)} style={styles.qtyBtn}><Ionicons name="add" size={16} color={TEXT_DARK} /></TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity onPress={() => addToCart(p)} style={[styles.addButton, {borderColor: ACCENT_COLOR, backgroundColor: `${ACCENT_COLOR}15`}]}>
                          <Text style={[styles.addButtonText, {color: '#047857'}]}>ADD</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>

      {/* STICKY FOOTER CART */}
      {cart.length > 0 && (
        <View style={styles.stickyFooter}>
          <TouchableOpacity style={[styles.cartBar, {backgroundColor: PRIMARY_COLOR}]} onPress={() => setIsCartOpen(true)}>
            <View style={styles.cartInfo}>
              <Ionicons name="cart" size={24} color="white" />
              <View style={{marginLeft: 10}}>
                <Text style={styles.cartItemCount}>{cart.length} ITEM{cart.length > 1 ? 'S' : ''}</Text>
                <Text style={styles.cartTotalText}>₹{finalTotal}</Text>
              </View>
            </View>
            <View style={styles.viewCartBtn}>
              <Text style={styles.viewCartText}>View cart</Text>
              <Ionicons name="chevron-forward" size={18} color="white" />
            </View>
          </TouchableOpacity>
        </View>
      )}

      {/* SCANNER MODAL */}
      <Modal visible={isScannerOpen} animationType="slide" transparent={false}>
        <SafeAreaView style={{flex: 1, backgroundColor: 'black'}}>
          <View style={{flexDirection: 'row', justifyContent: 'space-between', padding: 16}}>
            <Text style={{color: 'white', fontWeight: '900', fontSize: 18}}>SCAN QR</Text>
            <TouchableOpacity onPress={() => setIsScannerOpen(false)}><Ionicons name="close" size={28} color="white"/></TouchableOpacity>
          </View>
          <View style={{flex: 1, overflow: 'hidden', borderRadius: 20, margin: 16}}>
             <CameraView 
               style={{flex: 1}} 
               facing="back"
               barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
               onBarcodeScanned={({ data }) => {
                 const upiData = parseUpiData(data);
                 if (upiData && upiData.payeeAddress) {
                   setScannedPayee(upiData);
                   setScanAmount(upiData.amount ? String(upiData.amount) : '');
                   setIsScannerOpen(false);
                 } else {
                   setIsScannerOpen(false);
                   Alert.alert("Invalid QR", "This does not appear to be a valid UPI QR code.");
                 }
               }}
             />
             <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
                <View style={{flex: 1, backgroundColor: 'rgba(0,0,0,0.5)'}} />
                <View style={{flexDirection: 'row', height: 250}}>
                  <View style={{flex: 1, backgroundColor: 'rgba(0,0,0,0.5)'}} />
                  <View style={{width: 250, borderColor: PRIMARY_COLOR, borderWidth: 2, borderRadius: 16}} />
                  <View style={{flex: 1, backgroundColor: 'rgba(0,0,0,0.5)'}} />
                </View>
                <View style={{flex: 1, backgroundColor: 'rgba(0,0,0,0.5)'}} />
             </View>
          </View>
        </SafeAreaView>
      </Modal>

      {/* SCANNED PAYEE MODAL */}
      <Modal visible={!!scannedPayee} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, {height: '50%', padding: 24}]}>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20}}>
              <View>
                <Text style={{fontSize: 10, color: TEXT_MUTED, fontWeight: '900', letterSpacing: 1}}>PAYING</Text>
                <Text style={{fontSize: 24, fontWeight: '900', color: TEXT_DARK}}>{scannedPayee?.payeeName || 'Merchant'}</Text>
                <Text style={{fontSize: 12, color: PRIMARY_COLOR, fontWeight: 'bold'}}>{scannedPayee?.payeeAddress}</Text>
              </View>
              <TouchableOpacity onPress={() => setScannedPayee(null)}><Ionicons name="close" size={24}/></TouchableOpacity>
            </View>
            <View style={{flexDirection: 'row', alignItems: 'center', borderBottomWidth: 2, borderBottomColor: '#eee', paddingBottom: 10, marginBottom: 20}}>
              <Text style={{fontSize: 40, fontWeight: '900', color: TEXT_MUTED}}>₹</Text>
              <TextInput 
                style={{fontSize: 48, fontWeight: '900', color: TEXT_DARK, flex: 1, marginLeft: 10}}
                keyboardType="numeric" value={scanAmount} onChangeText={setScanAmount} autoFocus
              />
            </View>
            <TouchableOpacity 
              style={[styles.payButton, {backgroundColor: TEXT_DARK, justifyContent: 'center', opacity: !scanAmount ? 0.5 : 1}]} 
              disabled={!scanAmount}
              onPress={() => { Alert.alert("Triggering Razorpay", `Amount: ₹${scanAmount}`); setScannedPayee(null); }}
            >
              <Text style={[styles.payButtonText, {color: 'white'}]}>Pay Securely</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* CART MODAL */}
      <Modal visible={isCartOpen} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            
            <View style={styles.modalHeader}>
              <View style={{flexDirection: 'row', alignItems: 'center'}}>
                <TouchableOpacity onPress={() => setIsCartOpen(false)} style={{marginRight: 10}}>
                  <Ionicons name="arrow-back" size={24} color={TEXT_DARK} />
                </TouchableOpacity>
                <Text style={styles.modalTitle}>My Cart</Text>
              </View>
              <TouchableOpacity style={{flexDirection: 'row', alignItems: 'center'}}>
                <Ionicons name="share-social-outline" size={20} color={PRIMARY_COLOR} />
                <Text style={{fontWeight: 'bold', marginLeft: 4, color: PRIMARY_COLOR}}>Share</Text>
              </TouchableOpacity>
            </View>

            {itemTotal > 0 && itemTotal < 100 && (
              <View style={[styles.upsellBanner, {backgroundColor: '#FEF2F2', borderBottomColor: '#FEE2E2'}]}>
                <Text style={[styles.upsellText, {color: '#EF4444', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5}]}>Add ₹{100 - itemTotal} more to avoid the ₹20 Small Cart Fee!</Text>
              </View>
            )}
            {itemTotal >= 100 && itemTotal < 200 && (
              <View style={[styles.upsellBanner, {backgroundColor: `${PRIMARY_COLOR}15`, borderBottomColor: `${PRIMARY_COLOR}40`}]}>
                <Text style={[styles.upsellText, {color: PRIMARY_COLOR}]}>Add ₹{200 - itemTotal} more to skip the ₹30 Delivery Charge!</Text>
              </View>
            )}

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              
              <View style={styles.deliveryETAHeader}>
                <Ionicons name="time-outline" size={24} color={PRIMARY_COLOR} />
                <View style={{marginLeft: 10}}>
                  <Text style={{fontSize: 16, fontWeight: 'bold', color: TEXT_DARK}}>Delivery in 20 minutes</Text>
                </View>
              </View>

              <Text style={styles.shipmentText}>Shipment of {cart.length} item</Text>
              <View style={styles.whiteBox}>
                {cart.map((c, i) => (
                  <View key={i} style={styles.cartRow}>
                    <View style={{flex: 1}}>
                      <Text style={styles.cartItemName} numberOfLines={2}>{c.item.name}</Text>
                      <Text style={styles.unitText}>{c.item.weight || c.item.unit}</Text>
                      <Text style={styles.cartRowPrice}>₹{c.item.price * c.qty}</Text>
                    </View>
                    <View style={[styles.qtyBoxSmall, {backgroundColor: ACCENT_COLOR}]}>
                      <TouchableOpacity onPress={() => removeFromCart(c.item.id)} style={styles.qtyBtnSmall}><Ionicons name="remove" size={14} color={TEXT_DARK} /></TouchableOpacity>
                      <Text style={[styles.qtyTextSmall, {color: TEXT_DARK}]}>{c.qty}</Text>
                      <TouchableOpacity onPress={() => addToCart(c.item)} style={styles.qtyBtnSmall}><Ionicons name="add" size={14} color={TEXT_DARK} /></TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>

              {/* Zeshu Coins Toggle */}
              <View style={[styles.coinsToggle, useZeshuCoins && {backgroundColor: `${PRIMARY_COLOR}10`, borderColor: PRIMARY_COLOR}]}>
                <Image source={{ uri: ZESHU_LOGO_URL }} style={{width: 32, height: 32, borderRadius: 8}} />
                <View style={{ flex: 1, marginLeft: 15 }}>
                  <Text style={[styles.toggleTitle, { color: TEXT_DARK }]}>Zeshu Coins Balance: {coinsBalance}</Text>
                  <Text style={[styles.toggleSub, { color: TEXT_MUTED }]}>You can save ₹{Math.min(ZESHU_COINS_VAL, itemTotal)}</Text>
                </View>
                <TouchableOpacity onPress={() => setUseZeshuCoins(!useZeshuCoins)} style={{backgroundColor: useZeshuCoins ? '#FEE2E2' : `${PRIMARY_COLOR}15`, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8}}>
                  <Text style={{fontWeight: 'bold', color: useZeshuCoins ? '#DC2626' : PRIMARY_COLOR}}>{useZeshuCoins ? 'REMOVE' : 'APPLY'}</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.shipmentText}>Bill details</Text>
              <View style={styles.whiteBox}>
                <View style={styles.billRow}><Text style={styles.billLabel}>Items total</Text><Text style={styles.billVal}>₹{itemTotal}</Text></View>
                {useZeshuCoins && <View style={styles.billRow}><Text style={[styles.billLabel, {color: PRIMARY_COLOR}]}>Zeshu Coins</Text><Text style={[styles.billVal, {color: PRIMARY_COLOR}]}>-₹{zeshuDiscount}</Text></View>}
                <View style={styles.billRow}><Text style={styles.billLabel}>Delivery charge</Text><Text style={[styles.billVal, deliveryCharge===0 && {color: PRIMARY_COLOR}]}>{deliveryCharge === 0 ? 'FREE' : `₹${deliveryCharge}`}</Text></View>
                <View style={styles.billRow}><Text style={styles.billLabel}>Handling charge</Text><Text style={styles.billVal}>₹{HANDLING_FEE}</Text></View>
                {smallCartCharge > 0 && <View style={styles.billRow}><Text style={[styles.billLabel, {color: '#EF4444'}]}>Small cart charge</Text><Text style={[styles.billVal, {color: '#EF4444'}]}>₹{smallCartCharge}</Text></View>}
                
                <View style={[styles.billRow, { borderTopWidth: 1, borderColor: '#E5E7EB', marginTop: 10, paddingTop: 15 }]}>
                  <Text style={styles.grandLabel}>Grand total</Text>
                  <Text style={styles.grandVal}>₹{finalTotal}</Text>
                </View>
              </View>

              {/* Feeding India Donation */}
              <View style={styles.donationBox}>
                <View style={{flex: 1}}>
                  <Text style={styles.donationTitle}>Feeding India donation</Text>
                  <Text style={styles.donationSub}>Working towards a malnutrition free India. <Text style={{color: PRIMARY_COLOR}}>Feeding India...read more</Text></Text>
                </View>
                <TouchableOpacity onPress={() => setIsDonating(!isDonating)} style={{alignItems: 'center'}}>
                  <Ionicons name={isDonating ? "checkbox" : "square-outline"} size={24} color={isDonating ? PRIMARY_COLOR : "#D1D5DB"} />
                  <Text style={{fontWeight: 'bold', marginTop: 4}}>₹1</Text>
                </TouchableOpacity>
              </View>

              {/* Tip Component */}
              <View style={styles.tipBox}>
                <Text style={styles.tipTitle}>Tip your delivery partner</Text>
                <Text style={styles.tipSub}>Your kindness means a lot! 100% of your tip will go directly to your delivery partner.</Text>
                <View style={styles.tipButtons}>
                  {[20, 30, 50].map((amt) => (
                    <TouchableOpacity 
                      key={amt} 
                      onPress={() => setTipAmount(tipAmount === amt ? 0 : amt)} 
                      style={[styles.tipBtn, tipAmount === amt && {borderColor: PRIMARY_COLOR, backgroundColor: `${PRIMARY_COLOR}15`}]}
                    >
                      <Text style={[styles.tipBtnText, tipAmount === amt && {color: PRIMARY_COLOR}]}>₹{amt}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity style={styles.tipBtn}><Text style={styles.tipBtnText}>Custom</Text></TouchableOpacity>
                </View>
              </View>

              <View style={styles.policyBox}>
                <Text style={styles.policyTitle}>Cancellation Policy</Text>
                <Text style={styles.policyText}>Orders cannot be cancelled once packed for delivery. In case of unexpected delays, a refund will be provided, if applicable.</Text>
              </View>

              <View style={styles.addressFooter}>
                <View style={styles.addressIconBg}><Text style={{color: 'white', fontWeight: 'bold'}}>E</Text></View>
                <View style={{flex: 1, paddingHorizontal: 10}}>
                  <Text style={{fontSize: 12, color: TEXT_MUTED}}>Delivering to the address</Text>
                  <Text style={styles.deliveringTo} numberOfLines={2}>{currentAddress}</Text>
                </View>
                <Text style={{color: PRIMARY_COLOR, fontWeight: 'bold', fontSize: 13}}>Change</Text>
              </View>
              <View style={{height: 80}} />
            </ScrollView>

            <View style={styles.checkoutFooter}>
               <View>
                 <Text style={styles.checkoutTotal}>₹{finalTotal}</Text>
                 <Text style={{color: PRIMARY_COLOR, fontSize: 10, fontWeight: '900', letterSpacing: 1}}>TOTAL</Text>
               </View>
               <TouchableOpacity style={[styles.payButton, {backgroundColor: ACCENT_COLOR, opacity: isCheckingOut ? 0.7 : 1}]} onPress={handleCheckout} disabled={isCheckingOut}>
                 {isCheckingOut ? <ActivityIndicator color={TEXT_DARK} /> : (
                   <>
                    <Text style={[styles.payButtonText, {color: TEXT_DARK}]}>Proceed To Pay</Text>
                    <Ionicons name="caret-forward" size={16} color={TEXT_DARK} style={{marginLeft: 5}} />
                   </>
                 )}
               </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* AUTH MODAL */}
      <Modal visible={showLoginModal} animationType="fade" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, {height: '50%'}]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{loginStep === 'phone' ? 'Login or Sign Up' : 'Verify OTP'}</Text>
              <TouchableOpacity onPress={() => setShowLoginModal(false)}><Ionicons name="close" size={24} color="#333" /></TouchableOpacity>
            </View>
            <View style={{padding: 20}}>
              {loginStep === 'phone' ? (
                <>
                  <Text style={styles.formLabel}>Mobile Number</Text>
                  <TextInput style={styles.input} placeholder="10-digit number" keyboardType="numeric" maxLength={10} value={phoneNumber} onChangeText={setPhoneNumber} />
                  <TouchableOpacity style={[styles.payButton, {backgroundColor: PRIMARY_COLOR, marginTop: 20, justifyContent: 'center'}]} onPress={handleSendOTP} disabled={isAuthLoading}>
                    {isAuthLoading ? <ActivityIndicator color="white" /> : <Text style={[styles.payButtonText, {color: 'white'}]}>Continue</Text>}
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.formLabel}>Enter OTP</Text>
                  <TextInput style={[styles.input, {letterSpacing: 5, textAlign: 'center', fontSize: 24}]} placeholder="----" keyboardType="numeric" maxLength={6} value={otp} onChangeText={setOtp} secureTextEntry />
                  <TouchableOpacity style={[styles.payButton, {backgroundColor: ACCENT_COLOR, marginTop: 20, justifyContent: 'center'}]} onPress={handleVerifyOTP} disabled={isAuthLoading}>
                    {isAuthLoading ? <ActivityIndicator color={TEXT_DARK} /> : <Text style={[styles.payButtonText, {color: TEXT_DARK}]}>Verify Securely</Text>}
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* COIN HISTORY MODAL */}
      <Modal visible={isCoinHistoryOpen} animationType="fade" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, {height: '60%'}]}>
            <View style={styles.modalHeader}><Text style={styles.modalTitle}>Zeshu Coin History</Text><TouchableOpacity onPress={() => setIsCoinHistoryOpen(false)}><Ionicons name="close" size={24} color="#333" /></TouchableOpacity></View>
            <ScrollView style={{padding: 20}}>
              <View style={{backgroundColor: '#FFFBEB', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#FDE68A', marginBottom: 20}}><Text style={{color: '#B45309', fontWeight: 'bold', fontSize: 14, textAlign: 'center'}}>Zeshu coins can be used for recharge and bill payment!</Text></View>
              <Text style={{fontWeight: 'bold', marginBottom: 15}}>Recent Transactions</Text>
              <View style={{flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#eee', paddingVertical: 12}}><View><Text style={{fontWeight: 'bold'}}>Airtel Prepaid</Text><Text style={{fontSize: 12, color: TEXT_MUTED}}>Cashback Earned</Text></View><Text style={{color: '#059669', fontWeight: 'bold'}}>+12 Coins</Text></View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ACCOUNT MODAL */}
      <Modal visible={isAccountOpen} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, {height: '75%'}]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>My Account</Text>
              <TouchableOpacity onPress={() => setIsAccountOpen(false)}><Ionicons name="close" size={24} color="#333" /></TouchableOpacity>
            </View>
            <ScrollView style={{padding: 20}}>
              {['My Orders', 'Saved Addresses', "FAQ's", 'Account Privacy', 'Log Out'].map((item, idx) => (
                <TouchableOpacity key={idx} style={styles.accountRow} onPress={() => { if(item==='Log Out') handleLogout(); }}>
                  <Text style={styles.accountRowText}>{item}</Text>
                  <Ionicons name="chevron-forward" size={20} color={TEXT_MUTED} />
                </TouchableOpacity>
              ))}
              
              <View style={styles.promoBanner}>
                <View style={{flex: 1}}>
                  <Text style={styles.promoTitle}>Simple way to{'\n'}get groceries{'\n'}at your doorstep</Text>
                  <Text style={styles.promoSub}>Scan the QR code and download zeshu super app</Text>
                </View>
                <Ionicons name="qr-code" size={60} color={PRIMARY_COLOR} />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ==========================================
// SCREEN 2: RECHARGE FORM
// ==========================================
function RechargeScreen({ route, navigation }) {
  const { service } = route.params; 
  const [number, setNumber] = useState('');
  const [operator, setOperator] = useState('');
  const [amount, setAmount] = useState('');
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [userId, setUserId] = useState(null); 
  const [isLoading, setIsLoading] = useState(false);
  const [plans, setPlans] = useState([]);
  const [fetchedBill, setFetchedBill] = useState(null);
  const [selectedPlanCategory, setSelectedPlanCategory] = useState("All");

  const providersList = PROVIDERS[service] || ['Generic Provider 1', 'Generic Provider 2'];
  const isPlanBased = service === 'Mobile' || service === 'DTH';
  const cashbackEarned = Math.floor((parseFloat(amount) || 0) * ((COMMISSION_RATES[operator] || 1.00) / 100) * 0.80); 

  useEffect(() => {
    const getUser = async () => {
      const { data } = await supabase.auth.getSession();
      if (data?.session) setUserId(data.session.user.id);
    }
    getUser();

    if (number.length === 10 && service === 'Mobile') {
      autoDetectAndFetchPlans(number);
    }
    setFetchedBill(null);
  }, [number, service]);

  const planCategories = useMemo(() => {
    if (!plans || plans.length === 0) return ["All"];
    return ["All", ...Array.from(new Set(plans.map(p => p.categoryName).filter(Boolean)))];
  }, [plans]);

  const filteredPlans = useMemo(() => {
    if (selectedPlanCategory === "All") return plans;
    return plans.filter(p => p.categoryName === selectedPlanCategory);
  }, [plans, selectedPlanCategory]);

  const autoDetectAndFetchPlans = async (num) => {
    setIsLoading(true); setPlans([]);
    try {
      const opRes = await fetch(`${BASE_URL}/api/fetch-operator?number=${num}&service=${service.toLowerCase()}`);
      const opText = await opRes.text();
      let opData = {};
      try { opData = JSON.parse(opText); } catch(e) {}

      if (opData && opData.operator) {
        // Case-insensitive operator matching
        const foundOpKey = Object.keys(OPERATORS_DATA[service] || {}).find(
           k => k.toLowerCase() === opData.operator.toLowerCase() || k.toLowerCase().includes(opData.operator.toLowerCase())
        );
        const finalOperator = foundOpKey || opData.operator;
        
        setOperator(finalOperator); 
        const opCode = OPERATORS_DATA[service]?.[finalOperator];
        
        if (opCode) {
          const planRes = await fetch(`${BASE_URL}/api/fetch-plans?number=${num}&operator=${opCode}&service=${service.toLowerCase()}`);
          const planText = await planRes.text();
          try {
             const planData = JSON.parse(planText);
             if(planData.plans) {
                setPlans(planData.plans);
                setSelectedPlanCategory("All");
             }
          } catch(e) {}
        }
      }
    } catch (err) { console.log("Fetch Error", err); }
    setIsLoading(false);
  };

  const fetchOffers = async () => {
    if (!number || !operator) return Alert.alert("Required", "Enter number and select operator");
    setIsLoading(true);
    try {
      const opCode = OPERATORS_DATA[service]?.[operator] || '2';
      const res = await fetch(`${BASE_URL}/api/fetch-plans?number=${number}&operator=${opCode}&service=${service.toLowerCase()}`);
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch(e) { throw new Error("Invalid response format"); }
      
      if (data && data.plans) {
        setPlans(data.plans);
        setSelectedPlanCategory("All");
      } else {
        Alert.alert("Notice", data.message || "No plans found.");
      }
    } catch (err) { Alert.alert("Error", "Failed to fetch offers"); }
    setIsLoading(false);
  };

  const fetchBillDetails = async () => {
    if (!number || !operator) return Alert.alert("Required", "Enter number and select operator");
    setIsLoading(true); setFetchedBill(null);
    try {
      const opCode = OPERATORS_DATA[service]?.[operator] || '475';
      const safeService = service.toLowerCase().replace(/\s/g, ''); 
      const res = await fetch(`${BASE_URL}/api/fetch-bill?service=${safeService}&number=${number}&operatorCode=${opCode}`);
      const data = await res.json();
      if (data.success && data.bill) { setFetchedBill(data.bill); setAmount(String(data.bill.DueAmount)); } 
      else { Alert.alert("Error", data.message || "Could not fetch bill details."); }
    } catch (err) { Alert.alert("Error", "Server error"); }
    setIsLoading(false);
  };

  const handleRechargeSubmit = async () => {
    if(!number || (!operator && service !== 'UPI Tools') || !amount) { Alert.alert("Incomplete Details", "Please fill all fields."); return; }
    if(!userId) { Alert.alert("Login Required", "Please login from home screen to continue"); return; }
    
    setIsCheckingOut(true);
    
    try {
      const orderResponse = await fetch(`${BASE_URL}/api/create-razorpay-order`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: amount })
      });
      const orderText = await orderResponse.text();
      let orderData;
      try { orderData = JSON.parse(orderText); } catch(e) { throw new Error("Invalid backend response"); }
      
      const orderId = orderData.id || (orderData.order && orderData.order.id);

      var options = { 
        description: `${operator} ${service} Recharge`, 
        image: ZESHU_LOGO_URL, 
        currency: orderData.currency || 'INR', 
        key: process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID || 'rzp_test_SZhZ5NLWfFtlJZ', 
        amount: orderData.amount || (parseInt(amount) * 100), 
        order_id: orderId, 
        name: 'ZESHU SUPER APP', 
        prefill: { email: 'customer@zeshu.in', contact: '9999999999', name: 'Zeshu User' }, 
        theme: { color: PRIMARY_COLOR } 
      };

      RazorpayCheckout.open(options).then(async (data) => { 
        try {
          await fetch(`${BASE_URL}/api/process-recharge`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              operatorCode: OPERATORS_DATA[service]?.[operator] || 'UPI', 
              circleCode: 13, number: number, amount: amount, userId: userId, orderId: orderId 
            })
          });
        } catch(e) {}
        
        Alert.alert('Payment Successful!', `🎉 You earned ₹${cashbackEarned} Cashback in Zeshu Coins!`); 
        navigation.goBack(); 
      }).catch((error) => { 
        Alert.alert('Payment Failed', error.description || error.error?.description || `Checkout cancelled.`); 
      });
    } catch(err) {
      Alert.alert("Network Error", "Could not reach payment gateway.");
    } finally {
      setIsCheckingOut(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={{flexDirection: 'row', alignItems: 'center'}} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={PRIMARY_COLOR} />
          <Text style={{fontSize: 18, fontWeight: 'bold', marginLeft: 10, color: TEXT_DARK}}>{service} Recharge</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={{padding: 16}}>
        <View style={styles.formContainer}>
          <Text style={styles.formLabel}>{service} Number / ID :</Text>
          <View style={{position: 'relative', justifyContent: 'center'}}>
             <TextInput style={styles.input} placeholder={`Enter details`} value={number} onChangeText={setNumber} keyboardType="numeric" />
             {isLoading && isPlanBased && <ActivityIndicator color={PRIMARY_COLOR} style={{position: 'absolute', right: 16}} />}
          </View>

          {service !== 'UPI Tools' && (
            <>
              <Text style={styles.formLabel}>Select Operator :</Text>
              <View style={styles.pickerContainer}>
                <Picker selectedValue={operator} onValueChange={(val) => setOperator(val)}>
                  <Picker.Item label="Select Operator*" value="" color="#999" />
                  {providersList.map(op => <Picker.Item key={op} label={op} value={op} />)}
                </Picker>
              </View>
            </>
          )}

          {isPlanBased ? (
             <TouchableOpacity onPress={fetchOffers} style={[styles.payButton, {backgroundColor: '#F3E8FF', marginTop: 15, justifyContent: 'center', borderColor: '#E9D5FF', borderWidth: 2, borderStyle: 'dashed'}]}>
               <Text style={[styles.payButtonText, {color: PRIMARY_COLOR, textTransform: 'uppercase', fontSize: 12}]}>View Best Recommended Offers</Text>
             </TouchableOpacity>
          ) : (
             <TouchableOpacity onPress={fetchBillDetails} disabled={isLoading || fetchedBill !== null} style={[styles.payButton, {backgroundColor: '#F3E8FF', marginTop: 15, justifyContent: 'center', borderColor: '#E9D5FF', borderWidth: 2, borderStyle: 'dashed', opacity: (isLoading || fetchedBill !== null) ? 0.5 : 1}]}>
               <Text style={[styles.payButtonText, {color: PRIMARY_COLOR, textTransform: 'uppercase', fontSize: 12}]}>{isLoading ? 'Fetching...' : 'Fetch Bill Details'}</Text>
             </TouchableOpacity>
          )}

          {fetchedBill && !isPlanBased && (
             <View style={{ backgroundColor: '#ECFDF5', borderColor: '#A7F3D0', borderWidth: 1, padding: 16, borderRadius: 16, marginTop: 16 }}>
               <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#D1FAE5', paddingBottom: 8, marginBottom: 8 }}><Text style={{ fontSize: 10, fontWeight: '900', color: '#059669', textTransform: 'uppercase' }}>Customer Name</Text><Text style={{ fontSize: 13, fontWeight: 'bold' }}>{fetchedBill.Name || 'N/A'}</Text></View>
               <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#D1FAE5', paddingBottom: 8, marginBottom: 8 }}><Text style={{ fontSize: 10, fontWeight: '900', color: '#059669', textTransform: 'uppercase' }}>Due Date</Text><Text style={{ fontSize: 13, fontWeight: 'bold', color: '#DC2626' }}>{fetchedBill.DueDate || 'N/A'}</Text></View>
               <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ fontSize: 11, fontWeight: '900', color: '#047857', textTransform: 'uppercase' }}>Total Due</Text><Text style={{ fontSize: 20, fontWeight: '900' }}>₹{fetchedBill.DueAmount || '0'}</Text></View>
             </View>
          )}

          {isPlanBased && plans.length > 0 && (
             <View style={{marginTop: 16}}>
               <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 10}}>
                 {planCategories.map((cat) => (
                   <TouchableOpacity key={cat} onPress={() => setSelectedPlanCategory(cat)} style={{backgroundColor: selectedPlanCategory === cat ? PRIMARY_COLOR : '#F3F4F6', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, marginRight: 8}}>
                     <Text style={{color: selectedPlanCategory === cat ? 'white' : TEXT_MUTED, fontSize: 10, fontWeight: '900', textTransform: 'uppercase'}}>{cat}</Text>
                   </TouchableOpacity>
                 ))}
               </ScrollView>
               <View style={{height: 250, backgroundColor: '#F9FAFB', borderRadius: 16, borderWidth: 1, borderColor: '#eee', padding: 8}}>
                 <ScrollView nestedScrollEnabled={true}>
                   {filteredPlans.map((plan, idx) => (
                     <TouchableOpacity key={idx} onPress={() => setAmount(String(plan.amount))} style={{backgroundColor: 'white', padding: 12, borderRadius: 12, marginBottom: 8, elevation: 1, borderColor: amount == plan.amount ? PRIMARY_COLOR : 'transparent', borderWidth: 2}}>
                       <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4}}>
                         <Text style={{fontWeight: '900', color: PRIMARY_COLOR, fontSize: 18}}>₹{plan.amount}</Text>
                         <View style={{backgroundColor: '#F3E8FF', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6}}><Text style={{fontSize: 9, fontWeight: '900', color: PRIMARY_COLOR}}>{plan.validity}</Text></View>
                       </View>
                       <Text style={{fontSize: 11, color: TEXT_MUTED}}>{plan.desc}</Text>
                     </TouchableOpacity>
                   ))}
                 </ScrollView>
               </View>
             </View>
          )}

          <View style={{opacity: (fetchedBill && !isPlanBased) ? 0.5 : 1}}>
             <Text style={styles.formLabel}>Amount (₹) :</Text>
             <TextInput style={styles.input} placeholder="0.00" keyboardType="numeric" value={amount} onChangeText={setAmount} editable={!(fetchedBill && !isPlanBased)} />
          </View>

          {amount !== '' && cashbackEarned > 0 && (
             <View style={{backgroundColor: '#F0FDF4', padding: 12, borderRadius: 8, marginTop: 15, borderWidth: 1, borderColor: '#86EFAC', flexDirection: 'row', alignItems: 'center'}}>
               <FontAwesome5 name="gift" size={16} color="#059669" />
               <Text style={{color: '#065F46', fontWeight: 'bold', marginLeft: 10}}>You will get ₹{cashbackEarned} Cashback!</Text>
             </View>
          )}

          <TouchableOpacity style={[styles.payButton, {backgroundColor: ACCENT_COLOR, marginTop: 30, justifyContent: 'center'}]} onPress={handleRechargeSubmit} disabled={isCheckingOut}>
             {isCheckingOut ? <ActivityIndicator color={TEXT_DARK} /> : <Text style={[styles.payButtonText, {color: TEXT_DARK}]}>Proceed to Pay ₹{amount || 0}</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Recharge" component={RechargeScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  header: { backgroundColor: 'white', padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  logoContainer: { flexDirection: 'row', alignItems: 'center' },
  logoImage: { width: 36, height: 36, borderRadius: 8, marginRight: 8 },
  logoText: { fontSize: 16, fontWeight: '900' },
  subLogoText: { fontSize: 9, fontWeight: 'bold', color: TEXT_MUTED },
  
  locationContainer: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  locationBox: { flex: 1 },
  deliveryText: { fontWeight: '900', fontSize: 18, color: TEXT_DARK },
  addressText: { fontSize: 12, color: TEXT_MUTED, marginTop: 2 },
  autoDetectBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#eee', backgroundColor: '#fff', justifyContent: 'center' },
  autoDetectText: { fontSize: 11, fontWeight: 'bold' },
  
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  coinsPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#FFF7ED' },
  coinsText: { fontSize: 13, fontWeight: 'bold', marginLeft: 6, color: '#B45309' },
  userIcon: { backgroundColor: '#F3F4F6', padding: 8, borderRadius: 100, marginLeft: 10 },
  searchBar: { backgroundColor: '#F3F4F6', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, paddingVertical: 12, borderRadius: 12 },
  searchInput: { flex: 1, marginLeft: 10, fontSize: 14, color: TEXT_DARK },
  
  phonePeCard: { backgroundColor: 'white', marginHorizontal: 16, marginTop: 16, borderRadius: 16, padding: 16, elevation: 1 },
  sectionTitle: { fontSize: 14, fontWeight: '900', marginBottom: 15, color: TEXT_DARK, textTransform: 'uppercase', letterSpacing: 0.5 },
  rechargeGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  gridItem: { alignItems: 'center', width: '25%', marginBottom: 20 },
  gridIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  gridLabel: { fontSize: 10, fontWeight: '600', color: '#4B5563', textAlign: 'center' },
  
  section: { padding: 16 },
  productGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  productCard: { backgroundColor: 'white', width: '47%', padding: 12, borderRadius: 12, marginBottom: 15, elevation: 1 },
  imageContainer: { height: 110, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F9FAFB', borderRadius: 8, marginBottom: 10 },
  productImage: { width: '70%', height: '70%' },
  etaBadge: { position: 'absolute', top: 4, left: 4, backgroundColor: 'white', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, elevation: 1 },
  etaText: { fontSize: 8, fontWeight: 'bold', color: PRIMARY_COLOR },
  productName: { fontSize: 12, fontWeight: '600', height: 32, color: TEXT_DARK },
  unitText: { fontSize: 10, color: TEXT_MUTED, marginBottom: 4 },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  priceText: { fontWeight: 'bold', color: TEXT_DARK, fontSize: 14 },
  addButton: { borderWidth: 1, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 6 },
  addButtonText: { fontWeight: '900', fontSize: 12 },
  qtyBox: { flexDirection: 'row', alignItems: 'center', borderRadius: 6, padding: 4 },
  qtyText: { marginHorizontal: 10, fontWeight: 'bold' },
  
  stickyFooter: { position: 'absolute', bottom: 20, left: 16, right: 16 },
  cartBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderRadius: 12, elevation: 4 },
  cartInfo: { flexDirection: 'row', alignItems: 'center' },
  cartTotalText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  cartItemCount: { color: 'white', fontSize: 11, opacity: 0.9, fontWeight: 'bold' },
  viewCartText: { color: 'white', fontWeight: 'bold', marginRight: 5, fontSize: 14 },
  
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#F9FAFB', borderTopLeftRadius: 20, borderTopRightRadius: 20, height: '92%' },
  modalHeader: { padding: 20, backgroundColor: 'white', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eee' },
  modalTitle: { fontSize: 18, fontWeight: '900', color: TEXT_DARK },
  
  deliveryETAHeader: { backgroundColor: 'white', padding: 16, flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  shipmentText: { fontSize: 13, fontWeight: 'bold', color: TEXT_MUTED, marginHorizontal: 16, marginBottom: 8, marginTop: 10 },
  
  whiteBox: { backgroundColor: 'white', padding: 16, marginHorizontal: 16, borderRadius: 16, marginBottom: 16 },
  cartRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  cartItemName: { fontSize: 13, fontWeight: '500', color: TEXT_DARK },
  cartRowPrice: { fontWeight: 'bold', fontSize: 14, color: TEXT_DARK, marginTop: 4 },
  qtyBoxSmall: { flexDirection: 'row', alignItems: 'center', borderRadius: 6, padding: 4, marginLeft: 16 },
  qtyBtnSmall: { paddingHorizontal: 6, paddingVertical: 2 }, 
  qtyTextSmall: { marginHorizontal: 10, fontWeight: 'bold', fontSize: 12 },
  
  donationBox: { backgroundColor: 'white', padding: 16, marginHorizontal: 16, borderRadius: 16, flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  donationTitle: { fontWeight: 'bold', fontSize: 14, color: TEXT_DARK },
  donationSub: { fontSize: 11, color: TEXT_MUTED, marginTop: 4, lineHeight: 16 },
  
  tipBox: { backgroundColor: 'white', padding: 16, marginHorizontal: 16, borderRadius: 16, marginBottom: 16 },
  tipTitle: { fontWeight: 'bold', fontSize: 14, color: TEXT_DARK },
  tipSub: { fontSize: 11, color: TEXT_MUTED, marginTop: 4, marginBottom: 12 },
  tipButtons: { flexDirection: 'row', justifyContent: 'space-between' },
  tipBtn: { borderWidth: 1, borderColor: '#eee', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20 },
  tipBtnText: { fontWeight: 'bold', color: TEXT_DARK },
  
  billRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  billLabel: { color: TEXT_MUTED, fontSize: 13 },
  billVal: { fontWeight: '600', fontSize: 13, color: TEXT_DARK },
  grandLabel: { fontSize: 16, fontWeight: '900', color: TEXT_DARK },
  grandVal: { fontSize: 16, fontWeight: '900', color: TEXT_DARK },
  
  policyBox: { marginHorizontal: 16, marginBottom: 16 },
  policyTitle: { fontWeight: 'bold', fontSize: 12, color: TEXT_DARK, marginBottom: 4 },
  policyText: { fontSize: 10, color: TEXT_MUTED, lineHeight: 14 },
  
  addressFooter: { flexDirection: 'row', backgroundColor: 'white', padding: 16, marginHorizontal: 16, borderRadius: 16, alignItems: 'center' },
  addressIconBg: { backgroundColor: '#111827', width: 30, height: 30, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  deliveringTo: { fontSize: 13, fontWeight: 'bold', color: TEXT_DARK, marginTop: 2 },
  
  checkoutFooter: { backgroundColor: 'white', padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#eee', paddingBottom: Platform.OS === 'ios' ? 30 : 16 },
  checkoutTotal: { fontSize: 20, fontWeight: '900', color: TEXT_DARK },
  payButton: { flexDirection: 'row', paddingVertical: 14, paddingHorizontal: 24, borderRadius: 12, alignItems: 'center' },
  payButtonText: { fontWeight: '900', fontSize: 16 },

  accountRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: '#eee' },
  accountRowText: { fontSize: 16, fontWeight: '600', color: TEXT_DARK },
  promoBanner: { backgroundColor: `${PRIMARY_COLOR}10`, padding: 20, borderRadius: 16, marginTop: 30, flexDirection: 'row', alignItems: 'center' },
  promoTitle: { fontSize: 18, fontWeight: '900', color: PRIMARY_COLOR, lineHeight: 24 },
  promoSub: { fontSize: 11, color: TEXT_MUTED, marginTop: 8 },

  formContainer: { backgroundColor: 'white', padding: 20, borderRadius: 16, elevation: 2 },
  formLabel: { fontSize: 14, fontWeight: 'bold', color: '#374151', marginBottom: 8, marginTop: 15 },
  input: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 15, fontSize: 16, backgroundColor: '#F9FAFB' },
  pickerContainer: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, overflow: 'hidden', backgroundColor: '#F9FAFB' },
  
  upsellBanner: { padding: 12, alignItems: 'center', borderBottomWidth: 1 },
  upsellText: { fontWeight: 'bold', fontSize: 12 },

  coinsToggle: { backgroundColor: 'white', padding: 16, marginHorizontal: 16, borderRadius: 16, flexDirection: 'row', alignItems: 'center', marginBottom: 16, borderWidth: 1, borderColor: '#eee' },
  toggleTitle: { fontWeight: 'bold', fontSize: 14 },
  toggleSub: { fontSize: 11, marginTop: 2 },
});