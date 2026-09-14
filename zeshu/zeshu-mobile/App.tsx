import React, { useState, useEffect, useRef, useMemo, ComponentProps } from 'react';
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

const customerUtilityHeaders = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
};

const BASE_URL = 'https://www.zeshu.in';

const { width, height } = Dimensions.get('window');
type RootStackParamList = { Home: undefined; Recharge: { service?: string } | undefined };
type MaterialIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type RechargePlan = { categoryName?: string; amount?: string | number; validity?: string; desc?: string };
type OperatorResponse = { operator?: string };
const Stack = createNativeStackNavigator<RootStackParamList>();

// --- MODERN UTILITY THEME ---
const PRIMARY_COLOR = '#087443'; 
const ACCENT_COLOR = '#DFF3E6';  
const TEXT_DARK = '#111827';
const TEXT_MUTED = '#6B7280';
const ZESHU_LOGO_URL = 'https://ui-avatars.com/api/?name=Z&background=8A2BE2&color=fff&rounded=true&bold=true&size=128';

const parseHistoricalOrderItems = (order) => {
  if (!Array.isArray(order?.items)) return [];
  const quantities = new Map();
  order.items.forEach((entry) => {
    const productId = String(entry?.item?.id ?? entry?.product_id ?? '');
    const quantity = Number(entry?.qty ?? entry?.quantity ?? 0);
    if (productId && Number.isInteger(quantity) && quantity > 0) quantities.set(productId, (quantities.get(productId) || 0) + quantity);
  });
  return Array.from(quantities, ([productId, quantity]) => ({ productId, quantity }));
};
const ORDER_STATUS_LABELS = { PENDING: 'Order placed', CONFIRMED: 'Confirmed', PREPARING: 'Being prepared', READY_FOR_PICKUP: 'Ready for pickup', PICKED_UP: 'Picked up', OUT_FOR_DELIVERY: 'Out for delivery', DELIVERED: 'Delivered', CANCELLED: 'Cancelled' };
const ACTIVE_ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'OUT_FOR_DELIVERY'];
const ORDER_TIMELINE_STATUSES = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'];

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
  const [selectedCategory, setSelectedCategory] = useState('');
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
  const [recentlyPurchased, setRecentlyPurchased] = useState([]);
  const [favoriteIds, setFavoriteIds] = useState(new Set());
  const [favoriteProducts, setFavoriteProducts] = useState([]);
  const [favoriteBusyId, setFavoriteBusyId] = useState(null);
  const [frequentCategories, setFrequentCategories] = useState([]);
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [mobileReviewOverall, setMobileReviewOverall] = useState(0);
  const [mobileReviewDelivery, setMobileReviewDelivery] = useState(0);
  const [mobileReviewStore, setMobileReviewStore] = useState(0);
  const [mobileReviewComment, setMobileReviewComment] = useState('');
  const [mobileReviewProductRatings, setMobileReviewProductRatings] = useState({});
  const [mobileReviewLoading, setMobileReviewLoading] = useState(false);
  const [mobileReviewMessage, setMobileReviewMessage] = useState('');
  const [mobileReviewExisting, setMobileReviewExisting] = useState(false);
  const [mobileReviewProductComments, setMobileReviewProductComments] = useState({});
  const [mobileProductAggregates, setMobileProductAggregates] = useState({});
  const [mobilePublicReviewsProduct, setMobilePublicReviewsProduct] = useState(null);
  const [mobilePublicReviews, setMobilePublicReviews] = useState([]);
  const [mobilePublicReviewsLoading, setMobilePublicReviewsLoading] = useState(false);

  const ZESHU_COINS_VAL = 50;
  const HANDLING_FEE = 5;

  useEffect(() => {
    const fetchProducts = async () => {
      const { data } = await supabase.from('products').select('*');
      if (data && data.length > 0) setProducts(data);
      else setProducts([]);
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
    if (!userId) { setMyOrders([]); setSavedAddresses([]); return; }

    const loadSavedAddresses = async () => {
      const { data } = await supabase.from('customer_addresses').select('*').order('is_default', { ascending: false }).order('created_at', { ascending: false });
      setSavedAddresses(data || []);
    };
    loadSavedAddresses();
    
    const fetchOrders = async () => {
      const { data } = await supabase.from('orders').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(20);
      if (data) setMyOrders(data);
    };
    fetchOrders();

    const channel = supabase.channel('customer-mobile-tracker')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `user_id=eq.${userId}` }, 
      (payload) => setMyOrders((current) => [payload.new, ...current.filter((order) => order.id !== payload.new?.id)].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))))
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  useEffect(() => {
    if (!userId) { setRecentlyPurchased([]); setFrequentCategories([]); return; }
    const deliveredOrders = myOrders.filter((order) => order.status === 'DELIVERED').slice(0, 12);
    const productIds = Array.from(new Set(deliveredOrders.flatMap((order) => parseHistoricalOrderItems(order).map((entry) => entry.productId))));
    if (!productIds.length) { setRecentlyPurchased([]); setFrequentCategories([]); return; }
    let mounted = true;
    const loadRecentlyPurchased = async () => {
      const { data, error } = await supabase.from('products').select('*').in('id', productIds);
      if (!mounted) return;
      if (error) { if (__DEV__) console.error('Recently purchased products load failed', error.message); setRecentlyPurchased([]); return; }
      const byId = new Map((data || []).map((product) => [String(product.id), product]));
      const seen = new Set();
      const ordered = [];
      const categoryCounts = new Map();
      deliveredOrders.forEach((order) => parseHistoricalOrderItems(order).forEach(({ productId, quantity }) => { const currentProduct = byId.get(productId); if (currentProduct?.category) categoryCounts.set(currentProduct.category, (categoryCounts.get(currentProduct.category) || 0) + quantity); if (!seen.has(productId) && byId.has(productId)) { seen.add(productId); ordered.push(byId.get(productId)); } }));
      setRecentlyPurchased(ordered.slice(0, 10));
      setFrequentCategories(Array.from(categoryCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([category]) => category));
    };
    loadRecentlyPurchased();
    return () => { mounted = false; };
  }, [userId, myOrders]);

  useEffect(() => {
    const ids = products.map((product) => String(product.id)).filter(Boolean);
    if (!ids.length) return;
    supabase.rpc('get_product_review_aggregates', { p_product_ids: ids }).then(({ data, error }) => {
      if (error) { if (__DEV__) console.error('Product review aggregates failed', error.message); return; }
      const next = {};
      (data || []).forEach((row) => { next[String(row.product_id)] = row; });
      setMobileProductAggregates(next);
    });
  }, [products]);

  useEffect(() => {
    if (!userId) { setFavoriteIds(new Set()); setFavoriteProducts([]); return; }
    let mounted = true;
    const loadFavorites = async () => {
      const { data, error } = await supabase.from('customer_favorites').select('product_id,created_at').order('created_at', { ascending: false }).limit(100);
      if (!mounted) return;
      if (error) { if (__DEV__) console.error('Favorites load failed', error.message); setFavoriteIds(new Set()); setFavoriteProducts([]); return; }
      const ids = (data || []).map((entry) => String(entry.product_id));
      if (!ids.length) { setFavoriteIds(new Set()); setFavoriteProducts([]); return; }
      const { data: productsData, error: productsError } = await supabase.from('products').select('*').in('id', ids);
      if (!mounted) return;
      if (productsError) { if (__DEV__) console.error('Favorite products load failed', productsError.message); setFavoriteProducts([]); return; }
      const byId = new Map((productsData || []).map((product) => [String(product.id), product]));
      const liveIds = ids.filter((id) => byId.has(id));
      setFavoriteIds(new Set(liveIds));
      setFavoriteProducts(liveIds.map((id) => byId.get(id)).filter(Boolean));
    };
    loadFavorites();
    return () => { mounted = false; };
  }, [userId]);

  const normalizedSearch = searchQuery.trim().replace(/\s+/g, ' ').toLowerCase();
  const productCategories = Array.from(new Set(products.map((product) => String(product?.category || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const filteredProducts = products.filter((product) => {
    const haystack = [product?.name, product?.category, product?.weight, product?.unit].filter(Boolean).join(' ').replace(/\s+/g, ' ').toLowerCase();
    return (!normalizedSearch || haystack.includes(normalizedSearch)) && (!selectedCategory || String(product?.category || '').trim() === selectedCategory);
  });

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
    else Alert.alert("Unable to send OTP", "We could not start OTP delivery. Check the number and try again later.");
  };

  const handleVerifyOTP = async () => {
    if (otp.length < 4) return;
    setIsAuthLoading(true);
    const { data, error } = await supabase.auth.verifyOtp({ phone: `+91${phoneNumber}`, token: otp, type: 'sms' });
    setIsAuthLoading(false);

    if (data.session && data.user && !error) {
      setUserId(data.session.user.id);
      setIsLoggedIn(true);
      setShowLoginModal(false);
      fetchCoinBalance(data.session.user.id);
    } else {
      Alert.alert("Incorrect or expired OTP", "Please try again or request a new OTP.");
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsLoggedIn(false); setUserId(null); setCoinsBalance(0); setIsAccountOpen(false);
    Alert.alert("Logged Out", "You have been successfully logged out.");
  };

  const toggleFavorite = async (product) => {
    if (!isLoggedIn || !userId) { setShowLoginModal(true); setLoginStep('phone'); return; }
    const productId = String(product.id);
    if (favoriteBusyId === productId) return;
    setFavoriteBusyId(productId);
    const isFavorite = favoriteIds.has(productId);
    const { error } = await supabase.rpc(isFavorite ? 'customer_remove_favorite' : 'customer_add_favorite', { p_product_id: product.id });
    setFavoriteBusyId(null);
    if (error) { if (__DEV__) console.error('Favorite update failed', error.message); return Alert.alert('Favorites', 'Could not update favorites. Please try again.'); }
    setFavoriteIds((current) => { const next = new Set(current); if (isFavorite) next.delete(productId); else next.add(productId); return next; });
    setFavoriteProducts((current) => isFavorite ? current.filter((entry) => String(entry.id) !== productId) : [product, ...current.filter((entry) => String(entry.id) !== productId)].slice(0, 100));
  };

  const addToCart = (product) => {
    if (product?.in_stock === false || (product?.quantity !== null && Number(product?.quantity) <= 0)) return Alert.alert('Unavailable', 'This product is currently unavailable.');
    const existing = cart.find(c => c.item.id === product.id);
    const cartVendorIds = Array.from(new Set(cart.map((entry) => entry.item?.vendor_id).filter(Boolean)));
    if (product?.vendor_id && cartVendorIds.some((vendorId) => vendorId !== product.vendor_id)) return Alert.alert('One store at a time', 'Checkout supports products from one store at a time.');
    if (existing && product.quantity !== null && existing.qty >= Number(product.quantity)) return Alert.alert('Quantity limit', 'Maximum available quantity already in your cart.');
    setCart((current) => { const currentItem = current.find((entry) => entry.item.id === product.id); return currentItem ? current.map(c => c.item.id === product.id ? { ...c, qty: c.qty + 1 } : c) : [...current, { item: product, qty: 1 }]; });
  };

  const reorderOrder = async (order) => {
    const items = parseHistoricalOrderItems(order);
    if (!items.length) return Alert.alert('Buy again', 'The items from this order are unavailable.');
    const { data, error } = await supabase.from('products').select('*').in('id', items.map((item) => item.productId));
    if (error) { if (__DEV__) console.error('Buy again load failed', error.message); return Alert.alert('Buy again', 'Could not load current product availability.'); }
    const byId = new Map((data || []).map((product) => [String(product.id), product]));
    let added = 0;
    items.forEach(({ productId, quantity }) => {
      const product = byId.get(productId);
      if (!product || product.in_stock === false || (product.quantity !== null && Number(product.quantity) <= 0)) return;
      const existing = cart.find((entry) => String(entry.item.id) === productId);
      const nextQuantity = (existing?.qty || 0) + quantity;
      if (product.quantity !== null && nextQuantity > Number(product.quantity)) return;
      if (existing) setCart((current) => current.map((entry) => String(entry.item.id) === productId ? { ...entry, qty: nextQuantity } : entry));
      else setCart((current) => [...current, { item: product, qty: quantity }]);
      added += 1;
    });
    if (added) Alert.alert('Added to cart', 'Current prices and availability were applied.');
    else Alert.alert('Buy again', 'None of these items are currently available.');
  };

  const submitMobileReview = async (order) => {
    if (!order?.id || mobileReviewOverall < 1 || mobileReviewLoading) return;
    setMobileReviewLoading(true); setMobileReviewMessage('');
    try {
      const { error } = await supabase.rpc('customer_submit_order_review', { p_order_id: order.id, p_overall_rating: mobileReviewOverall, p_delivery_rating: mobileReviewDelivery || null, p_store_rating: mobileReviewStore || null, p_comment: mobileReviewComment.trim() || null });
      if (error) throw error;
      for (const [productId, rating] of Object.entries(mobileReviewProductRatings)) {
        if (Number(rating) > 0) {
          const { error: productError } = await supabase.rpc('customer_submit_product_review', { p_order_id: order.id, p_product_id: productId, p_rating: Number(rating), p_comment: String(mobileReviewProductComments[productId] || '').trim() || null });
          if (productError) throw productError;
        }
      }
      setMobileReviewMessage('Verified review saved.');
    } catch (error) {
      if (__DEV__) console.error('Review submission failed', error?.message || error);
      setMobileReviewMessage('Could not save review. Please try again.');
    } finally { setMobileReviewLoading(false); }
  };

  const openMobilePublicReviews = async (product) => {
    setMobilePublicReviewsProduct(product); setMobilePublicReviews([]); setMobilePublicReviewsLoading(true);
    const { data, error } = await supabase.rpc('get_public_product_reviews', { p_product_id: product.id, p_limit: 20, p_offset: 0 });
    if (error && __DEV__) console.error('Public reviews load failed', error.message);
    setMobilePublicReviews(data || []); setMobilePublicReviewsLoading(false);
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
  const activeOrder = myOrders.find((order) => ACTIVE_ORDER_STATUSES.includes(order?.status));
  const deliveredOrder = myOrders.find((order) => order.status === 'DELIVERED');
  const renderMobileStars = (value, setter, label) => <View accessibilityLabel={label} style={{ flexDirection: 'row', marginTop: 5 }}>{[1, 2, 3, 4, 5].map((star) => <TouchableOpacity key={star} accessibilityRole="button" accessibilityLabel={`${label} ${star} star`} onPress={() => setter(star)}><Text style={{ color: star <= value ? '#f59e0b' : '#cbd5e1', fontSize: 26, marginRight: 2 }}>★</Text></TouchableOpacity>)}</View>;

  useEffect(() => {
    if (!deliveredOrder?.id || !userId) return;
    supabase.from('order_reviews').select('overall_rating,delivery_rating,store_rating,comment').eq('order_id', deliveredOrder.id).maybeSingle().then(({ data }) => {
      if (data) { setMobileReviewExisting(true); setMobileReviewOverall(Number(data.overall_rating) || 0); setMobileReviewDelivery(Number(data.delivery_rating) || 0); setMobileReviewStore(Number(data.store_rating) || 0); setMobileReviewComment(data.comment || ''); }
    });
    supabase.from('product_reviews').select('product_id,rating,comment').eq('order_id', deliveredOrder.id).then(({ data }) => {
      const ratings = {}; const comments = {};
      (data || []).forEach((review) => { ratings[String(review.product_id)] = Number(review.rating) || 0; comments[String(review.product_id)] = review.comment || ''; });
      setMobileReviewProductRatings(ratings); setMobileReviewProductComments(comments);
    });
  }, [deliveredOrder?.id, userId]);

  // 🚀 GROCERY CHECKOUT
  const handleCheckout = async () => {
    if (finalTotal === 0) return;
    if (!isLoggedIn || !userId) { setIsCartOpen(false); handleProfileClick(); return; }

    setIsCheckingOut(true);
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const orderResponse = await fetch(`${BASE_URL}/api/create-razorpay-order`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ cartItems: cart, deliveryAddress: currentAddress, isDonating, tipAmount, hasZeshuPass: false })
      });
      
      const textRes = await orderResponse.text();
      let orderData;
      try { orderData = JSON.parse(textRes); } catch(e) { Alert.alert('Server Error', `Invalid response from backend.`); setIsCheckingOut(false); return; }

      if (!orderResponse.ok || !orderData.success) { const raw = String(orderData.error || '').toLowerCase(); const message = raw.includes('price') ? 'A product price changed. Review your cart and try again.' : raw.includes('stock') || raw.includes('quantity') || raw.includes('unavailable') ? 'One or more products are no longer available in that quantity.' : raw.includes('session') || raw.includes('auth') ? 'Your customer session has expired. Please sign in again.' : 'Could not prepare secure checkout. Please review your cart and try again.'; Alert.alert('Checkout unavailable', message); setIsCheckingOut(false); return; }
      const orderId = orderData.orderId || orderData.id || (orderData.order && orderData.order.id);
      if (!orderId) { Alert.alert('Checkout Error', `Could not fetch Order ID.`); setIsCheckingOut(false); return; }

      var options = {
        description: 'Zeshu Super App Groceries',
        image: ZESHU_LOGO_URL,
        currency: orderData.currency || (orderData.order && orderData.order.currency) || 'INR',
        key: process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID, // Using actual .env key
        amount: orderData.amount || (orderData.order && orderData.order.amount),
        order_id: orderId, 
        name: 'ZESHU SUPER APP',
        prefill: { email: 'customer@zeshu.in', contact: '9999999999', name: 'Zeshu User' },
        theme: { color: PRIMARY_COLOR }
      };

      RazorpayCheckout.open(options).then(async (data) => {
        let confirmationData;
        try {
          // VERIFICATION STEP
          const verificationResponse = await fetch(`${BASE_URL}/api/verify-razorpay-payment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              razorpay_order_id: data.razorpay_order_id,
              razorpay_payment_id: data.razorpay_payment_id,
              razorpay_signature: data.razorpay_signature,
            }),
          });
          
          const verificationData = await verificationResponse.json();
          if (!verificationResponse.ok || !verificationData.success) {
            Alert.alert("Payment Verification Failed", "Could not verify payment securely.");
            return;
          }

          // ORDER CONFIRMATION STEP
          const { data: { session } } = await supabase.auth.getSession();
          const confirmationResponse = await fetch(`${BASE_URL}/api/confirm-grocery-order`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
            body: JSON.stringify({
              reservationId: orderData.reservationId,
              razorpay_payment_id: data.razorpay_payment_id,
              razorpay_order_id: data.razorpay_order_id,
              razorpay_signature: data.razorpay_signature,
            })
          });
          confirmationData = await confirmationResponse.json();
          if (!confirmationResponse.ok || !confirmationData.success) {
            const raw = String(confirmationData.error || '').toLowerCase();
            const message = raw.includes('stock') || raw.includes('quantity') || raw.includes('unavailable') ? 'Stock changed before confirmation. Your cart was kept available.' : raw.includes('price') ? 'A product price changed before confirmation. Your cart was kept available.' : 'Payment was verified, but order confirmation is still pending. Please do not pay again.';
            Alert.alert('Order confirmation pending', message);
            return;
          }
        } catch (e) { if (__DEV__) console.error("Backend sync error", e instanceof Error ? e.message : 'unknown error'); Alert.alert('Order not created', 'Payment was verified but we could not create your order. Please contact support.'); return; }

        const placedOrder = confirmationData.order || {};
        Alert.alert('Order placed', `Order #${String(placedOrder.id || orderId).split('-')[0].toUpperCase()}\nAmount paid: ₹${Number(placedOrder.total_paid || (orderData.amount / 100) || 0).toFixed(2)}\nStatus: ${placedOrder.status || 'PENDING'}\nDelivering to: ${placedOrder.delivery_address || currentAddress}`);
        setCart([]); 
        setIsCartOpen(false);
      }).catch((error) => {
        Alert.alert('Payment Failed', error.description || error.error?.description || 'Checkout could not be completed.');
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
              <Text style={styles.deliveryText}>Delivering to</Text>
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
          placeholder="Search products" 
            placeholderTextColor="#9CA3AF" 
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={searchQuery ? 'Clear search' : 'Voice search'} onPress={() => searchQuery && setSearchQuery('')}><Ionicons name={searchQuery ? 'close-circle' : 'mic'} size={22} color={PRIMARY_COLOR} /></TouchableOpacity>
        </View>
      </View>

      <ScrollView ref={scrollViewRef} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 150 }}>
        
        {/* LIVE ORDER TRACKER — uses only the real order status */}
        {activeOrder && <View style={{ backgroundColor: '#fff', padding: 20, margin: 16, borderRadius: 24, borderWidth: 1, borderColor: '#cfe8d7', elevation: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}><View><Text style={{ fontSize: 14, fontWeight: '900', color: PRIMARY_COLOR, textTransform: 'uppercase' }}>Your active order</Text><Text style={{ marginTop: 3, fontSize: 16, fontWeight: '900', color: TEXT_DARK }}>{ORDER_STATUS_LABELS[activeOrder.status] || 'Order in progress'}</Text></View><View style={{ backgroundColor: '#eef8f1', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 }}><Text style={{ fontSize: 10, fontWeight: '900', color: PRIMARY_COLOR }}>#{activeOrder.id.split('-')[0].toUpperCase()}</Text></View></View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'space-between' }}>{ORDER_TIMELINE_STATUSES.map((step) => { const orderIndex = ORDER_TIMELINE_STATUSES.indexOf(activeOrder.status); const stepIndex = ORDER_TIMELINE_STATUSES.indexOf(step); const complete = stepIndex <= orderIndex; return <View key={step} style={{ alignItems: 'center', width: 76 }}><View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: complete ? PRIMARY_COLOR : '#fff', borderWidth: 2, borderColor: complete ? PRIMARY_COLOR : '#dbe5df', justifyContent: 'center', alignItems: 'center' }}><Ionicons name={complete ? 'checkmark' : 'ellipse-outline'} size={14} color={complete ? '#fff' : '#94a3b8'} /></View><Text numberOfLines={2} style={{ marginTop: 6, textAlign: 'center', fontSize: 9, fontWeight: '800', color: complete ? PRIMARY_COLOR : '#64748b' }}>{ORDER_STATUS_LABELS[step]}</Text></View>; })}</ScrollView>
          {activeOrder.delivery_address && <Text numberOfLines={2} style={{ marginTop: 12, fontSize: 11, color: TEXT_MUTED }}>Delivering to: {activeOrder.delivery_address}</Text>}
        </View>}
        {!activeOrder && myOrders.find((order) => order.status === 'DELIVERED') && <View style={{ backgroundColor: '#fff', padding: 18, margin: 16, borderRadius: 22, borderWidth: 1, borderColor: '#dbe5df' }}><Text style={{ fontSize: 14, fontWeight: '900', color: TEXT_DARK }}>Your last order was delivered</Text><Text style={{ marginTop: 4, fontSize: 12, color: TEXT_MUTED }}>Order #{myOrders.find((order) => order.status === 'DELIVERED').id.split('-')[0].toUpperCase()} · ₹{Number(myOrders.find((order) => order.status === 'DELIVERED').total_paid || 0).toFixed(0)}</Text><View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}><TouchableOpacity onPress={() => reorderOrder(myOrders.find((order) => order.status === 'DELIVERED'))} style={{ borderRadius: 10, backgroundColor: PRIMARY_COLOR, paddingHorizontal: 14, paddingVertical: 10 }}><Text style={{ color: '#fff', fontWeight: '900', fontSize: 12 }}>Buy again</Text></TouchableOpacity><TouchableOpacity onPress={() => Alert.alert('Delivered order', myOrders.find((order) => order.status === 'DELIVERED').delivery_address || 'Delivery address unavailable.')} style={{ borderRadius: 10, borderWidth: 1, borderColor: PRIMARY_COLOR, paddingHorizontal: 14, paddingVertical: 10 }}><Text style={{ color: PRIMARY_COLOR, fontWeight: '900', fontSize: 12 }}>View details</Text></TouchableOpacity></View></View>}
        {!activeOrder && deliveredOrder && <View style={{ backgroundColor: '#fffbeb', padding: 18, marginHorizontal: 16, marginBottom: 16, borderRadius: 22, borderWidth: 1, borderColor: '#fde68a' }}><Text style={{ fontSize: 16, fontWeight: '900', color: TEXT_DARK }}>{mobileReviewExisting ? 'Edit your review' : 'Rate your order'}</Text><Text style={{ marginTop: 4, fontSize: 12, color: TEXT_MUTED }}>{mobileReviewExisting ? 'You rated this order before.' : 'Verified purchase'} · Order #{deliveredOrder.id.split('-')[0].toUpperCase()}</Text><Text style={{ marginTop: 12, fontSize: 12, fontWeight: '900', color: TEXT_DARK }}>Overall experience</Text>{renderMobileStars(mobileReviewOverall, setMobileReviewOverall, 'Overall experience')}<Text style={{ marginTop: 10, fontSize: 12, fontWeight: '900', color: TEXT_DARK }}>Store experience</Text>{renderMobileStars(mobileReviewStore, setMobileReviewStore, 'Store experience')}<Text style={{ marginTop: 10, fontSize: 12, fontWeight: '900', color: TEXT_DARK }}>Delivery experience</Text>{renderMobileStars(mobileReviewDelivery, setMobileReviewDelivery, 'Delivery experience')}<TextInput value={mobileReviewComment} onChangeText={(text) => setMobileReviewComment(text.slice(0, 1000))} placeholder="Optional comment (plain text)" multiline style={{ marginTop: 12, minHeight: 60, borderWidth: 1, borderColor: '#f1d58a', borderRadius: 12, backgroundColor: '#fff', padding: 10, textAlignVertical: 'top' }} />{parseHistoricalOrderItems(deliveredOrder).map(({ productId }) => { const product = products.find((item) => String(item.id) === productId); return <View key={productId} style={{ marginTop: 10 }}><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Text numberOfLines={1} style={{ flex: 1, marginRight: 8, fontSize: 12, fontWeight: '800', color: TEXT_DARK }}>{product?.name || 'Purchased product'}</Text>{renderMobileStars(Number(mobileReviewProductRatings[productId] || 0), (value) => setMobileReviewProductRatings((current) => ({ ...current, [productId]: value })), `${product?.name || 'Product'} rating`)}</View><TextInput value={String(mobileReviewProductComments[productId] || '')} onChangeText={(text) => setMobileReviewProductComments((current) => ({ ...current, [productId]: text.slice(0, 1000) }))} placeholder="Optional product comment" style={{ marginTop: 5, borderWidth: 1, borderColor: '#f1d58a', borderRadius: 10, backgroundColor: '#fff', padding: 8 }} /></View>; })}<TouchableOpacity disabled={mobileReviewLoading || mobileReviewOverall < 1} onPress={() => void submitMobileReview(deliveredOrder)} style={{ marginTop: 14, borderRadius: 12, backgroundColor: mobileReviewOverall < 1 ? '#94a3b8' : PRIMARY_COLOR, paddingVertical: 12 }}><Text style={{ textAlign: 'center', color: '#fff', fontWeight: '900' }}>{mobileReviewLoading ? 'Saving review...' : mobileReviewExisting ? 'Update review' : 'Submit review'}</Text></TouchableOpacity>{mobileReviewMessage ? <Text style={{ marginTop: 8, fontSize: 12, fontWeight: '800', color: mobileReviewMessage.includes('saved') ? '#047857' : '#b91c1c' }}>{mobileReviewMessage}</Text> : null}</View>}
        {!activeOrder && myOrders.find((order) => order.status === 'CANCELLED') && <View style={{ backgroundColor: '#fff', padding: 18, margin: 16, borderRadius: 22, borderWidth: 1, borderColor: '#fecaca' }}><Text style={{ fontSize: 14, fontWeight: '900', color: '#991b1b' }}>Order cancelled</Text><Text style={{ marginTop: 4, fontSize: 12, color: TEXT_MUTED }}>Order #{myOrders.find((order) => order.status === 'CANCELLED').id.split('-')[0].toUpperCase()} · No delivery is scheduled.</Text></View>}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 4, gap: 8 }} accessibilityLabel="Product categories">
          <TouchableOpacity onPress={() => setSelectedCategory('')} style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, backgroundColor: selectedCategory === '' ? PRIMARY_COLOR : '#fff', borderWidth: 1, borderColor: selectedCategory === '' ? PRIMARY_COLOR : '#dbe5df' }}><Text style={{ color: selectedCategory === '' ? '#fff' : TEXT_DARK, fontWeight: '900', fontSize: 12 }}>All</Text></TouchableOpacity>
          {productCategories.map((category) => <TouchableOpacity key={category} onPress={() => setSelectedCategory(category)} style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, backgroundColor: selectedCategory === category ? PRIMARY_COLOR : '#fff', borderWidth: 1, borderColor: selectedCategory === category ? PRIMARY_COLOR : '#dbe5df' }}><Text style={{ color: selectedCategory === category ? '#fff' : TEXT_DARK, fontWeight: '900', fontSize: 12 }}>{category}</Text></TouchableOpacity>)}
        </ScrollView>

        {searchQuery === '' && (
          <View style={styles.phonePeCard}>
            <Text style={styles.sectionTitle}>BILLS & RECHARGES</Text>
            <View style={styles.rechargeGrid}>
              {([
                { n: 'Mobile', i: 'cellphone' }, { n: 'Postpaid', i: 'phone-check' }, 
                { n: 'DTH', i: 'television-classic' }, { n: 'UPI Tools', i: 'bank-transfer' }, 
                { n: 'FASTag', i: 'car-connected' }, { n: 'Electricity', i: 'flash' }, 
                { n: 'Piped Gas', i: 'fire' }, { n: 'LPG Booking', i: 'gas-cylinder' }, 
                { n: 'Water', i: 'water' }, { n: 'Broadband', i: 'wifi' }, 
                { n: 'Loan EMI', i: 'bank' }, { n: 'Insurance', i: 'shield-check' }
              ] as { n: string; i: MaterialIconName }[]).map((item, idx) => (
                <TouchableOpacity key={idx} style={styles.gridItem} onPress={() => navigation.navigate('Recharge', { service: item.n })}>
                  <View style={styles.gridIcon}><MaterialCommunityIcons name={item.i} size={28} color={PRIMARY_COLOR} /></View>
                  <Text style={styles.gridLabel}>{item.n}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {isLoggedIn && (favoriteProducts.length > 0 || recentlyPurchased.length > 0 || frequentCategories.length > 0) && searchQuery === '' && (
          <View style={{ marginHorizontal: 16, marginBottom: 8, padding: 14, borderRadius: 18, backgroundColor: '#f7fbf8', borderWidth: 1, borderColor: '#dce8df' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text style={{ fontSize: 18, fontWeight: '900', color: '#173d27' }}>Quick Picks</Text><Text style={{ fontSize: 10, fontWeight: '900', color: '#5d8069' }}>FOR YOU</Text></View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
              {recentlyPurchased.length > 0 && <TouchableOpacity onPress={() => scrollViewRef.current?.scrollTo({ y: 0, animated: true })} style={{ paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: '#fff', marginRight: 8 }}><Text style={{ color: '#087443', fontWeight: '900', fontSize: 12 }}>Buy Again</Text></TouchableOpacity>}
              {favoriteProducts.length > 0 && <TouchableOpacity onPress={() => scrollViewRef.current?.scrollTo({ y: 0, animated: true })} style={{ paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: '#fff', marginRight: 8 }}><Text style={{ color: '#087443', fontWeight: '900', fontSize: 12 }}>Favorites</Text></TouchableOpacity>}
              {frequentCategories.map((category) => <TouchableOpacity key={category} onPress={() => { setSelectedCategory(category); scrollViewRef.current?.scrollToEnd({ animated: true }); }} style={{ paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: '#fff', marginRight: 8 }}><Text style={{ color: '#087443', fontWeight: '900', fontSize: 12 }}>{category}</Text></TouchableOpacity>)}
            </ScrollView>
          </View>
        )}

        {isLoggedIn && favoriteProducts.length > 0 && searchQuery === '' && (
          <View style={styles.section}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text style={styles.sectionTitle}>Your Favorites</Text><Ionicons name="heart" size={20} color={PRIMARY_COLOR} /></View>
            <Text style={{ color: TEXT_MUTED, fontSize: 12, marginBottom: 10 }}>Live prices and availability from your saved products.</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {favoriteProducts.slice(0, 10).map((product) => {
                const unavailable = product.in_stock === false || (product.quantity !== null && Number(product.quantity) <= 0) || !product.vendor_id;
                return <View key={product.id} style={{ width: 150, marginRight: 12, padding: 10, borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#fff' }}><Image source={{ uri: product.image_url }} style={{ height: 86, width: '100%' }} resizeMode="contain" /><Text numberOfLines={2} style={{ fontSize: 12, fontWeight: '800', color: TEXT_DARK }}>{product.name}</Text><Text style={{ fontWeight: '900', marginTop: 4 }}>₹{product.price}</Text>{unavailable ? <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}><Text style={{ color: '#dc2626', fontSize: 10, fontWeight: '800' }}>Unavailable</Text><TouchableOpacity onPress={() => toggleFavorite(product)}><Text style={{ color: TEXT_MUTED, fontSize: 10, fontWeight: '800' }}>Remove</Text></TouchableOpacity></View> : <TouchableOpacity onPress={() => addToCart(product)} style={{ marginTop: 7, paddingVertical: 7, borderRadius: 8, backgroundColor: ACCENT_COLOR }}><Text style={{ textAlign: 'center', color: '#047857', fontSize: 11, fontWeight: '900' }}>ADD</Text></TouchableOpacity>}</View>;
              })}
            </ScrollView>
          </View>
        )}

        {isLoggedIn && recentlyPurchased.length > 0 && searchQuery === '' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recently Purchased</Text>
            <Text style={{ color: TEXT_MUTED, fontSize: 12, marginBottom: 10 }}>Buy again at today&apos;s price and availability.</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {recentlyPurchased.map((product) => {
                const unavailable = product.in_stock === false || (product.quantity !== null && Number(product.quantity) <= 0) || !product.vendor_id;
                return <View key={product.id} style={{ width: 150, marginRight: 12, padding: 10, borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#fff' }}><Image source={{ uri: product.image_url }} style={{ height: 86, width: '100%' }} resizeMode="contain" /><Text numberOfLines={2} style={{ fontSize: 12, fontWeight: '800', color: TEXT_DARK }}>{product.name}</Text><Text style={{ fontWeight: '900', marginTop: 4 }}>₹{product.price}</Text>{unavailable ? <Text style={{ color: '#dc2626', fontSize: 10, fontWeight: '800', marginTop: 6 }}>Currently unavailable</Text> : <TouchableOpacity onPress={() => addToCart(product)} style={{ marginTop: 7, paddingVertical: 7, borderRadius: 8, backgroundColor: ACCENT_COLOR }}><Text style={{ textAlign: 'center', color: '#047857', fontSize: 11, fontWeight: '900' }}>ADD</Text></TouchableOpacity>}</View>;
              })}
            </ScrollView>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Grocery & Kitchen</Text>
          
          {products.length === 0 && searchQuery === '' ? (
            <ActivityIndicator size="large" color={PRIMARY_COLOR} style={{ marginTop: 30 }} />
          ) : filteredProducts.length === 0 ? (
            <View style={{ marginTop: 10 }}><Text style={{ color: TEXT_MUTED }}>No products found{normalizedSearch ? ` for "${searchQuery.trim()}"` : ''}.</Text><View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}><TouchableOpacity onPress={() => setSearchQuery('')} style={{ borderRadius: 10, backgroundColor: PRIMARY_COLOR, paddingHorizontal: 12, paddingVertical: 9 }}><Text style={{ color: '#fff', fontSize: 12, fontWeight: '900' }}>Clear search</Text></TouchableOpacity><TouchableOpacity onPress={() => setSelectedCategory('')} style={{ borderRadius: 10, borderWidth: 1, borderColor: PRIMARY_COLOR, paddingHorizontal: 12, paddingVertical: 9 }}><Text style={{ color: PRIMARY_COLOR, fontSize: 12, fontWeight: '900' }}>Browse all</Text></TouchableOpacity></View></View>
          ) : (
            <View style={styles.productGrid}>
              {filteredProducts.map((p) => {
                const inCart = cart.find(c => c.item.id === p.id);
                return (
                  <View key={p.id} style={styles.productCard}>
                    <View style={styles.imageContainer}>
                      <TouchableOpacity accessibilityRole="button" accessibilityLabel={favoriteIds.has(String(p.id)) ? `Remove ${p.name} from favorites` : `Add ${p.name} to favorites`} onPress={() => toggleFavorite(p)} disabled={favoriteBusyId === String(p.id)} style={{ position: 'absolute', right: 8, top: 8, zIndex: 2, width: 34, height: 34, borderRadius: 17, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}><Ionicons name={favoriteIds.has(String(p.id)) ? 'heart' : 'heart-outline'} size={18} color={PRIMARY_COLOR} /></TouchableOpacity>
                      <Image source={{ uri: p.image_url }} style={styles.productImage} resizeMode="contain" />
                    </View>
                    <Text style={styles.unitText}>{p.weight || p.unit || 'N/A'}</Text>
                    <Text style={styles.productName} numberOfLines={2}>{p.name}</Text>
                    {mobileProductAggregates[String(p.id)] ? <Text style={{ marginTop: 3, fontSize: 10, fontWeight: '900', color: '#b45309' }}>★ {Number(mobileProductAggregates[String(p.id)].average_rating || 0).toFixed(1)} ({Number(mobileProductAggregates[String(p.id)].review_count || 0)})</Text> : <Text style={{ marginTop: 3, fontSize: 10, color: '#94a3b8' }}>No reviews yet</Text>}
                    <TouchableOpacity onPress={() => void openMobilePublicReviews(p)} style={{ marginTop: 3 }}><Text style={{ fontSize: 10, fontWeight: '900', color: PRIMARY_COLOR }}>See reviews</Text></TouchableOpacity>
                    <View style={styles.priceRow}>
                      <Text style={styles.priceText}>₹{p.price}</Text>
                      {inCart ? (
                        <View style={[styles.qtyBox, {backgroundColor: ACCENT_COLOR}]}>
                          <TouchableOpacity onPress={() => removeFromCart(p.id)} style={styles.qtyBtn}><Ionicons name="remove" size={16} color={TEXT_DARK} /></TouchableOpacity>
                          <Text style={[styles.qtyText, {color: TEXT_DARK}]}>{inCart.qty}</Text>
                          <TouchableOpacity onPress={() => addToCart(p)} style={styles.qtyBtn}><Ionicons name="add" size={16} color={TEXT_DARK} /></TouchableOpacity>
                        </View>
                      ) : (p.in_stock === false || (p.quantity !== null && Number(p.quantity) <= 0)) ? (
                        <View style={[styles.addButton, { borderColor: '#e2e8f0', backgroundColor: '#f8fafc' }]}><Text style={[styles.addButtonText, { color: '#94a3b8' }]}>UNAVAILABLE</Text></View>
                      ) : (
                        <TouchableOpacity onPress={() => addToCart(p)} style={[styles.addButton, {borderColor: ACCENT_COLOR, backgroundColor: `${ACCENT_COLOR}15`}]}><Text style={[styles.addButtonText, {color: '#047857'}]}>ADD</Text></TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>

      <Modal visible={!!mobilePublicReviewsProduct} animationType="slide" transparent>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <View style={{ maxHeight: '82%', borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: '#fff', padding: 20 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><View><Text style={{ fontSize: 18, fontWeight: '900', color: TEXT_DARK }}>Reviews for {mobilePublicReviewsProduct?.name}</Text><Text style={{ marginTop: 3, fontSize: 11, color: TEXT_MUTED }}>Verified purchases only</Text></View><TouchableOpacity accessibilityLabel="Close reviews" onPress={() => setMobilePublicReviewsProduct(null)}><Ionicons name="close-circle" size={28} color={TEXT_MUTED} /></TouchableOpacity></View>
            <ScrollView style={{ marginTop: 14 }}><Text style={{ fontSize: 12, fontWeight: '900', color: TEXT_MUTED }}>{mobilePublicReviewsLoading ? 'Loading reviews...' : mobilePublicReviews.length ? '' : 'No written reviews yet.'}</Text>{mobilePublicReviews.map((review, index) => <View key={`${review.updated_at || review.created_at}-${index}`} style={{ marginTop: 10, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 14, padding: 12 }}><Text style={{ color: '#f59e0b', fontSize: 18 }}>{'★'.repeat(Number(review.rating || 0))}</Text><Text style={{ marginTop: 5, color: TEXT_DARK }}>{review.comment}</Text><View style={{ marginTop: 8, flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ fontSize: 10, fontWeight: '900', color: PRIMARY_COLOR }}>Verified purchase</Text><Text style={{ fontSize: 10, color: TEXT_MUTED }}>{new Date(review.updated_at || review.created_at).toLocaleDateString()}</Text></View></View>)}</ScrollView>
          </View>
        </View>
      </Modal>

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
              onPress={() => Alert.alert('Payments unavailable', 'Merchant QR payments are not configured yet. No payment has been started.')}
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
                  <Text style={{fontSize: 16, fontWeight: 'bold', color: TEXT_DARK}}>Delivery details</Text>
                  <Text style={{fontSize: 11, color: TEXT_MUTED, marginTop: 2}}>Availability and total are validated before payment.</Text>
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
                      <TouchableOpacity onPress={() => addToCart(c.item)} disabled={c.item.quantity !== null && c.qty >= Number(c.item.quantity)} style={[styles.qtyBtnSmall, c.item.quantity !== null && c.qty >= Number(c.item.quantity) && { opacity: 0.35 }]}><Ionicons name="add" size={14} color={TEXT_DARK} /></TouchableOpacity>
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
                <Text style={{color: PRIMARY_COLOR, fontWeight: 'bold', fontSize: 11}}>Choose below</Text>
              </View>
              {savedAddresses.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }} contentContainerStyle={{ gap: 8 }}>{savedAddresses.map((address) => <TouchableOpacity key={address.id} onPress={() => setCurrentAddress(`${address.address_line || ''}${address.city ? `, ${address.city}` : ''}${address.state ? `, ${address.state}` : ''}${address.postal_code ? ` - ${address.postal_code}` : ''}`.trim())} style={{ borderRadius: 10, borderWidth: 1, borderColor: '#dbe5df', paddingHorizontal: 12, paddingVertical: 9, backgroundColor: '#fff' }}><Text style={{ fontSize: 11, fontWeight: '900', color: PRIMARY_COLOR }}>{address.label || 'Address'}</Text></TouchableOpacity>)}</ScrollView>}
              <View style={{height: 80}} />
            </ScrollView>

            <View style={styles.checkoutFooter}>
               <Text style={{ position: 'absolute', left: 16, right: 16, bottom: 64, textAlign: 'center', color: TEXT_MUTED, fontSize: 10, fontWeight: '700' }}>Secure payment powered by Razorpay. Total and stock are checked again before payment.</Text>
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
  const [plans, setPlans] = useState<RechargePlan[]>([]);
  const [fetchedBill, setFetchedBill] = useState(null);
  const [selectedPlanCategory, setSelectedPlanCategory] = useState("All");

  const providersList = PROVIDERS[service] || ['Generic Provider 1', 'Generic Provider 2'];
  const isPlanBased = service === 'Mobile' || service === 'DTH';
  const cashbackEarned = Math.floor((parseFloat(amount) || 0) * ((COMMISSION_RATES[operator] || 1.00) / 100) * 0.80); 

  useEffect(() => {
    const getUser = async () => {
      const { data } = await supabase.auth.getSession();
      if (data?.session) setUserId(data.session.user.id);
    };
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
      const opRes = await fetch(`${BASE_URL}/api/fetch-operator?number=${num}&service=${service.toLowerCase()}`, { headers: await customerUtilityHeaders() });
      const opText = await opRes.text();
      let opData: OperatorResponse = {};
      try { opData = JSON.parse(opText); } catch(e) {}

      if (opData && opData.operator) {
        const foundOpKey = Object.keys(OPERATORS_DATA[service] || {}).find(
           k => k.toLowerCase() === opData.operator.toLowerCase() || k.toLowerCase().includes(opData.operator.toLowerCase())
        );
        const finalOperator = foundOpKey || opData.operator;
        
        setOperator(finalOperator); 
        const opCode = OPERATORS_DATA[service]?.[finalOperator];
        
        if (opCode) {
          const planRes = await fetch(`${BASE_URL}/api/fetch-plans?number=${num}&operator=${opCode}&service=${service.toLowerCase()}`, { headers: await customerUtilityHeaders() });
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
    } catch (err) { if (__DEV__) console.error("Fetch Error", err instanceof Error ? err.message : 'unknown error'); }
    setIsLoading(false);
  };

  const fetchOffers = async () => {
    if (!number || !operator) return Alert.alert("Required", "Enter number and select operator");
    setIsLoading(true);
    try {
      const opCode = OPERATORS_DATA[service]?.[operator] || '2';
      const res = await fetch(`${BASE_URL}/api/fetch-plans?number=${number}&operator=${opCode}&service=${service.toLowerCase()}`, { headers: await customerUtilityHeaders() });
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
      const res = await fetch(`${BASE_URL}/api/fetch-bill?service=${safeService}&number=${number}&operatorCode=${opCode}`, { headers: await customerUtilityHeaders() });
      const data = await res.json();
      if (data.success && data.bill) { setFetchedBill(data.bill); setAmount(String(data.bill.DueAmount)); } 
      else { Alert.alert("Error", data.message || "Could not fetch bill details."); }
    } catch (err) { Alert.alert("Error", "Server error"); }
    setIsLoading(false);
  };

  // 🚀 FIXED RECHARGE CHECKOUT HANDLER
  const handleRechargeSubmit = async () => {
    Alert.alert('Service unavailable', 'Recharge and bill-payment fulfillment is not configured. No payment has been started.');
    return;

    if (!number || (!operator && service !== 'UPI Tools') || !amount) { 
      Alert.alert("Incomplete Details", "Please fill all fields."); 
      return; 
    }
    if (!userId) { 
      Alert.alert("Login Required", "Please login from home screen to continue"); 
      return; 
    }
    
    const rechargeAmount = Number(amount);
    if (!Number.isFinite(rechargeAmount) || rechargeAmount <= 0) {
      Alert.alert("Invalid Amount", "Please enter a valid recharge amount.");
      return;
    }

    setIsCheckingOut(true);
    
    try {
      const orderResponse = await fetch(`${BASE_URL}/api/create-razorpay-order`, {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ amount: rechargeAmount })
      });
      
      const orderText = await orderResponse.text();
      let orderData;
      try { 
        orderData = JSON.parse(orderText); 
      } catch(e) { 
        throw new Error("Invalid response from payment server."); 
      }

      if (!orderResponse.ok || !orderData.success) {
        throw new Error(orderData.error || "Could not create payment order.");
      }

      const orderId = orderData.id || orderData.order?.id || orderData.orderId;
      if (!orderId) { 
        throw new Error("Razorpay Order ID was not received."); 
      }

      const razorpayKey = process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID;

      if (!razorpayKey) {
        Alert.alert('Payment Error', 'Razorpay key is not configured.');
        return;
      }

      var options = { 
        description: `${operator || service} ${service} Recharge`, 
        image: ZESHU_LOGO_URL, 
        currency: orderData.currency || 'INR', 
        key: razorpayKey, 
        amount: orderData.amount || (rechargeAmount * 100), 
        order_id: orderId, 
        name: 'ZESHU SUPER APP', 
        prefill: { email: 'customer@zeshu.in', contact: '9999999999', name: 'Zeshu User' }, 
        theme: { color: PRIMARY_COLOR } 
      };

      const paymentData = await RazorpayCheckout.open(options);

      if (!paymentData?.razorpay_payment_id || !paymentData?.razorpay_order_id || !paymentData?.razorpay_signature) {
        throw new Error("Razorpay did not return complete payment verification data.");
      }

      // Verify signature on backend
      const verificationResponse = await fetch(`${BASE_URL}/api/verify-razorpay-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id: paymentData.razorpay_order_id,
          razorpay_payment_id: paymentData.razorpay_payment_id,
          razorpay_signature: paymentData.razorpay_signature,
        }),
      });

      const verificationData = await verificationResponse.json();
      if (!verificationResponse.ok || !verificationData.success || !verificationData.verified) {
        Alert.alert("Payment Verification Failed", "Your payment could not be verified securely.");
        return;
      }

      // Process actual recharge via API
      await fetch(`${BASE_URL}/api/process-recharge`, {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          operatorCode: OPERATORS_DATA[service]?.[operator] || 'UPI', 
          circleCode: 13, 
          number: number, 
          amount: rechargeAmount, 
          userId: userId, 
          orderId: paymentData.razorpay_order_id,
          paymentId: paymentData.razorpay_payment_id
        })
      });
        
      Alert.alert('Payment Successful!', `🎉 You earned ₹${cashbackEarned} Cashback in Zeshu Coins!`); 
      navigation.goBack(); 

    } catch (error) {
      Alert.alert('Payment Failed', error?.description || error?.error?.description || error?.message || 'Checkout was cancelled.');
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
      <Stack.Navigator id="zeshu-mobile" screenOptions={{ headerShown: false }}>
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
  qtyBtn: { minWidth: 30, minHeight: 30, alignItems: 'center', justifyContent: 'center' },
  qtyText: { marginHorizontal: 10, fontWeight: 'bold' },
  
  stickyFooter: { position: 'absolute', bottom: 20, left: 16, right: 16 },
  cartBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderRadius: 12, elevation: 4 },
  cartInfo: { flexDirection: 'row', alignItems: 'center' },
  cartTotalText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  cartItemCount: { color: 'white', fontSize: 11, opacity: 0.9, fontWeight: 'bold' },
  viewCartText: { color: 'white', fontWeight: 'bold', marginRight: 5, fontSize: 14 },
  viewCartBtn: { flexDirection: 'row', alignItems: 'center' },
  
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#F9FAFB', borderTopLeftRadius: 20, borderTopRightRadius: 20, height: '92%' },
  modalBody: { flex: 1 },
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
