import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, FlatList, ActivityIndicator, Alert, Modal } from 'react-native';
import * as Location from 'expo-location';
import { supabase } from './supabase';
import { MapPin, Navigation, Power, IndianRupee, History, X, CheckCircle2, LogOut } from 'lucide-react-native';

const devLog = (...args: unknown[]) => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.info(...args);
};

export default function DashboardScreen({ navigation }: any) {
  const [isOnline, setIsOnline] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);
  const [historyOrders, setHistoryOrders] = useState<any[]>([]); 
  const [totalEarnings, setTotalEarnings] = useState(0); 
  const [hasRecordedEarnings, setHasRecordedEarnings] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false); 
  const [riderId, setRiderId] = useState<string | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [availabilityMessage, setAvailabilityMessage] = useState('');
  const [availabilityUpdating, setAvailabilityUpdating] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [newAssignmentId, setNewAssignmentId] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] = useState<'Offline' | 'Tracking' | 'Permission denied' | 'Location unavailable'>('Offline');
  const locationSubscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const locationStartingRef = useRef(false);
  const isOnlineRef = useRef(false);

  const stopLocationTracking = () => {
    locationSubscriptionRef.current?.remove();
    locationSubscriptionRef.current = null;
    locationStartingRef.current = false;
  };

  const updateRiderLocation = async (position: Location.LocationObject, profileId: string, userId: string) => {
    const { error } = await supabase
      .from('riders')
      .update({
        current_latitude: position.coords.latitude,
        current_longitude: position.coords.longitude,
      })
      .eq('id', profileId)
      .eq('user_id', userId);

    if (error) {
      devLog('Rider location update failed:', error);
      return false;
    }

    devLog('Rider location updated for authenticated profile.');
    return true;
  };

  const getCurrentPosition = async () => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Location request timed out.')), 15000);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  const startLocationWatcher = async (profileId: string, userId: string) => {
    if (locationSubscriptionRef.current || locationStartingRef.current) return;
    locationStartingRef.current = true;

    try {
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 50,
          timeInterval: 60000,
        },
        (position) => {
          if (!isOnlineRef.current) return;
          void updateRiderLocation(position, profileId, userId).then((updated) => {
            if (!updated) setLocationStatus('Location unavailable');
          });
        },
        (error) => {
          devLog('Rider location watcher error:', error);
          setLocationStatus('Location unavailable');
        },
      );

      if (!isOnlineRef.current) {
        subscription.remove();
        return;
      }
      locationSubscriptionRef.current = subscription;
      setLocationStatus('Tracking');
    } catch (error) {
      devLog('Could not start rider location watcher:', error);
      setLocationStatus('Location unavailable');
    } finally {
      locationStartingRef.current = false;
    }
  };

  // 1. Get the Rider's ID
  useEffect(() => {
    const getUser = async () => {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      devLog('Rider profile auth user:', user?.id ?? null);
      if (authError || !user) {
        devLog('Rider profile auth lookup error:', authError ?? 'No authenticated user');
        setAvailabilityMessage('Your session could not be verified. Please sign in again.');
        return;
      }
      setSessionUserId(user.id);
      const { data, error } = await supabase.from('riders').select('id,is_active').eq('user_id', user.id).maybeSingle();
      devLog('Rider profile lookup result:', data ?? null);
      if (error) devLog('Rider profile lookup error:', error);
      if (!data) {
        setAvailabilityMessage('Rider profile not found. Complete rider setup first.');
        return;
      }
      setAvailabilityMessage('');
      setRiderId(data.id);
      setIsOnline(Boolean(data.is_active));
      isOnlineRef.current = Boolean(data.is_active);
    };
    getUser();
  }, []);

  useEffect(() => {
    if (!isOnline || !riderId || !sessionUserId) {
      stopLocationTracking();
      if (!isOnline) setLocationStatus('Offline');
      return;
    }

    void startLocationWatcher(riderId, sessionUserId);
  }, [isOnline, riderId, sessionUserId]);

  useEffect(() => () => {
    stopLocationTracking();
  }, []);

  // 2. Real-time Engine
  useEffect(() => {
    if (!riderId) return;

    fetchMyOrders();

    const channel = supabase
      .channel('rider-live-feed')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `rider_id=eq.${riderId}` },
        (payload) => {
          const nextOrder = payload.new as { id?: string; status?: string };
          if (payload.eventType === 'INSERT' || nextOrder.status === 'READY_FOR_PICKUP' || nextOrder.status === 'OUT_FOR_DELIVERY') setNewAssignmentId(nextOrder.id ?? null);
          fetchMyOrders();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [riderId]);

  // 3. Unified Fetch (Active + History + Earnings)
  const fetchMyOrders = async () => {
    if (!riderId) return;
    setLoading(true);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0); 

    const { data, error } = await supabase
      .from('orders')
      .select('id, status, delivery_address, delivery_fee, created_at, payout_status, items, vendor_id')
      .eq('rider_id', riderId)
      .gte('created_at', today.toISOString())
      .order('created_at', { ascending: false });

    if (data) {
      // Set Active Orders
      const active = data.filter(o => ['READY_FOR_PICKUP', 'PICKED_UP', 'OUT_FOR_DELIVERY'].includes(o.status));
      setOrders(active);

      // Set History Orders
      const delivered = data.filter(o => o.status?.toUpperCase() === 'DELIVERED');
      setHistoryOrders(delivered);

      // Calculate Today's Earnings
      const recordedFees = delivered.map(order => Number(order.delivery_fee)).filter(fee => Number.isFinite(fee) && fee > 0);
      const earnings = recordedFees.reduce((sum, fee) => sum + fee, 0);
      setTotalEarnings(earnings);
      setHasRecordedEarnings(recordedFees.length > 0);
    }
    setLoading(false);
  };

  const updateAvailability = async (next: boolean) => {
    devLog('Rider availability button pressed:', next ? 'online' : 'offline');
    setAvailabilityMessage('');
    setAvailabilityUpdating(true);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    devLog('Rider availability auth user:', user?.id ?? null);
    if (authError || !user) {
      devLog('Rider availability auth lookup error:', authError ?? 'No authenticated user');
      setAvailabilityMessage('Your session could not be verified. Please sign in again.');
      setAvailabilityUpdating(false);
      return false;
    }

    const { data: profile, error: profileError } = await supabase
      .from('riders')
      .select('id,is_active')
      .eq('user_id', user.id)
      .maybeSingle();
    devLog('Rider availability profile lookup result:', profile ?? null);
    if (profileError) devLog('Rider availability profile lookup error:', profileError);
    if (profileError || !profile) {
      setAvailabilityMessage('Rider profile not found. Complete rider setup first.');
      setAvailabilityUpdating(false);
      return false;
    }

    setSessionUserId(user.id);
    setRiderId(profile.id);

    if (next) {
      setLocationStatus('Location unavailable');
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationStatus('Permission denied');
        setAvailabilityMessage('Location permission is required before you can go online.');
        setAvailabilityUpdating(false);
        return false;
      }

      try {
        const position = await getCurrentPosition();
        const locationSaved = await updateRiderLocation(position, profile.id, user.id);
        if (!locationSaved) {
          setLocationStatus('Location unavailable');
          setAvailabilityMessage('Your location could not be saved. Please try again.');
          setAvailabilityUpdating(false);
          return false;
        }
      } catch (error) {
        devLog('Initial rider location unavailable:', error);
        setLocationStatus('Location unavailable');
        setAvailabilityMessage('Location is unavailable. Enable location services and try again.');
        setAvailabilityUpdating(false);
        return false;
      }
    }

    devLog('Rider availability RPC attempt:', { riderId: profile.id, userId: user.id, is_active: next });
    const { data, error } = await supabase.rpc('rider_set_availability', { p_is_active: next });
    devLog('Rider availability RPC result:', error ?? { is_active: data?.is_active });
    if (error) {
      if (error.message?.includes('rider is administratively suspended')) {
        setAvailabilityMessage('Your rider account has been suspended by admin.');
      } else {
        setAvailabilityMessage('Could not update your availability. Please try again.');
      }
      setAvailabilityUpdating(false);
      return false;
    }
    const updatedAvailability = typeof data?.is_active === 'boolean' ? data.is_active : next;
    isOnlineRef.current = updatedAvailability;
    if (!updatedAvailability) {
      stopLocationTracking();
      setLocationStatus('Offline');
    }
    setIsOnline(updatedAvailability);
    setAvailabilityMessage(updatedAvailability ? 'You are online and ready for assignments.' : 'You are offline.');
    setAvailabilityUpdating(false);
    return true;
  };

  const handleToggleDuty = async () => {
    if (availabilityUpdating || loggingOut) return;
    await updateAvailability(!isOnline);
  };

  const handleLogout = async () => {
    if (availabilityUpdating || loggingOut) return;
    setLoggingOut(true);
    setAvailabilityMessage('');
    if (isOnline) {
      const offline = await updateAvailability(false);
      if (!offline) {
        setLoggingOut(false);
        setAvailabilityMessage('Could not go offline, so you have not been logged out. Please try again.');
        return;
      }
    }

    const { error } = await supabase.auth.signOut();
    if (error) {
      devLog('Rider sign-out failed:', error);
      setLoggingOut(false);
      setAvailabilityMessage('Could not log out. Please try again.');
      return;
    }
    setOrders([]);
    setHistoryOrders([]);
    setRiderId(null);
    setSessionUserId(null);
    stopLocationTracking();
    setLocationStatus('Offline');
    isOnlineRef.current = false;
    setIsOnline(false);
    navigation.replace('Login');
  };
  const navigateToOrder = (order: any) => navigation.navigate('ActiveOrder', { order, riderId });

  return (
    <View style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      
      {/* --- HEADER SECTION --- */}
      <View style={{ backgroundColor: '#0f172a', paddingTop: 60, paddingBottom: 30, paddingHorizontal: 20, borderBottomLeftRadius: 30, borderBottomRightRadius: 30 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View>
            <Text style={{ color: '#fff', fontSize: 24, fontWeight: '900', letterSpacing: 1 }}>ZESHU RIDER</Text>
            <Text style={{ color: '#94a3b8', fontSize: 14, fontWeight: '700' }}>Live Dispatch</Text>
          </View>
          
          <View style={{ alignItems: 'flex-end' }}>
            {/* Earnings Badge */}
            <View style={{ backgroundColor: '#1e293b', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <IndianRupee size={14} color="#10b981" />
              <Text style={{ color: '#10b981', fontWeight: '900', marginLeft: 4 }}>Today: {hasRecordedEarnings ? `₹${totalEarnings}` : '—'}</Text>
            </View>
            
            {/* History Button */}
            <TouchableOpacity onPress={() => setShowHistory(true)} style={{ backgroundColor: '#334155', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, flexDirection: 'row', alignItems: 'center' }}>
              <History size={12} color="#cbd5e1" />
              <Text style={{ color: '#cbd5e1', fontSize: 10, fontWeight: '900', marginLeft: 6, textTransform: 'uppercase' }}>History</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity 
          onPress={handleToggleDuty}
          disabled={availabilityUpdating || loggingOut}
          style={{ marginTop: 20, height: 70, opacity: availabilityUpdating || loggingOut ? 0.6 : 1, backgroundColor: isOnline ? '#ef4444' : '#10b981', borderRadius: 20, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', elevation: 10 }}
        >
          {availabilityUpdating ? <ActivityIndicator color="#fff" /> : <><Power color="#fff" size={28} style={{ marginRight: 12 }} /><Text style={{ color: '#fff', fontSize: 22, fontWeight: '900', textTransform: 'uppercase' }}>{isOnline ? 'Go Offline' : 'Go Online'}</Text></>}
        </TouchableOpacity>
        {availabilityMessage ? <Text accessibilityRole="alert" style={{ color: '#fef3c7', fontSize: 13, fontWeight: '700', textAlign: 'center', marginTop: 12 }}>{availabilityMessage}</Text> : null}
        <Text style={{ color: isOnline ? '#86efac' : '#cbd5e1', fontSize: 13, fontWeight: '800', textAlign: 'center', marginTop: 10 }}>{isOnline ? 'You are Online' : 'You are Offline'}</Text>
        <Text style={{ color: locationStatus === 'Tracking' ? '#86efac' : '#cbd5e1', fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: 6 }}>Location: {locationStatus}</Text>
        <TouchableOpacity onPress={handleLogout} disabled={availabilityUpdating || loggingOut} style={{ marginTop: 16, minHeight: 52, opacity: availabilityUpdating || loggingOut ? 0.6 : 1, borderWidth: 1, borderColor: '#475569', borderRadius: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
          {loggingOut ? <ActivityIndicator color="#cbd5e1" /> : <><LogOut color="#cbd5e1" size={18} style={{ marginRight: 8 }} /><Text style={{ color: '#e2e8f0', fontSize: 14, fontWeight: '900' }}>Log Out</Text></>}
        </TouchableOpacity>
      </View>

      {/* --- ACTIVE ORDERS LIST --- */}
      <View style={{ flex: 1, padding: 20 }}>
        {newAssignmentId ? <TouchableOpacity accessibilityRole="alert" onPress={() => setNewAssignmentId(null)} style={{ backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#86efac', borderRadius: 16, padding: 14, marginBottom: 14 }}><Text style={{ color: '#047857', fontWeight: '900' }}>New assigned delivery</Text><Text style={{ color: '#166534', marginTop: 3, fontSize: 12 }}>Order #{newAssignmentId.split('-')[0].toUpperCase()} is ready to review.</Text></TouchableOpacity> : null}
        <Text style={{ fontSize: 16, fontWeight: '900', color: '#64748b', textTransform: 'uppercase', marginBottom: 16 }}>
          {isOnline ? 'Active Deliveries' : 'You are Offline'}
        </Text>

        {!isOnline ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', opacity: 0.5 }}>
            <Power size={64} color="#cbd5e1" />
            <Text style={{ marginTop: 16, fontSize: 18, fontWeight: '800', color: '#94a3b8' }}>Go online to receive orders</Text>
          </View>
        ) : loading && orders.length === 0 ? (
          <ActivityIndicator size="large" color="#0f172a" style={{ marginTop: 40 }} />
        ) : orders.length === 0 ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <View style={{ width: 100, height: 100, borderRadius: 50, backgroundColor: '#e2e8f0', justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <MapPin size={40} color="#94a3b8" />
            </View>
            <Text style={{ fontSize: 18, fontWeight: '800', color: '#64748b' }}>Waiting for orders...</Text>
          </View>
        ) : (
          <FlatList
            data={orders}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <TouchableOpacity 
                onPress={() => navigateToOrder(item)}
                style={{ backgroundColor: '#fff', padding: 20, borderRadius: 24, marginBottom: 16, borderWidth: 1, borderColor: '#e2e8f0', elevation: 3 }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <View style={{ backgroundColor: '#f1f5f9', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 }}>
                    <Text style={{ fontSize: 12, fontWeight: '900', color: '#64748b' }}>#{item.id.split('-')[0].toUpperCase()}</Text>
                  </View>
                  <Text style={{ fontSize: 12, fontWeight: '900', color: '#0f766e' }}>{item.status?.replaceAll('_', ' ')}</Text>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 20 }}>
                  <MapPin color="#0f172a" size={24} style={{ marginRight: 12 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase' }}>Drop Location</Text>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: '#0f172a' }}>{item.delivery_address}</Text>
                  </View>
                </View>

                <View style={{ backgroundColor: '#0f172a', padding: 16, borderRadius: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: 16, fontWeight: '900', marginRight: 8 }}>Review delivery</Text>
                  <Navigation color="#fff" size={18} />
                </View>
              </TouchableOpacity>
            )}
          />
        )}
      </View>

      {/* --- EARNINGS HISTORY MODAL --- */}
      <Modal visible={showHistory} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowHistory(false)}>
        <View style={{ flex: 1, backgroundColor: '#f8fafc' }}>
          <View style={{ padding: 20, paddingTop: 40, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Text style={{ fontSize: 24, fontWeight: '900', color: '#0f172a' }}>Today's History</Text>
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#10b981' }}>{hasRecordedEarnings ? `Recorded delivery fees: ₹${totalEarnings}` : 'No recorded rider earnings yet'}</Text>
            </View>
            <TouchableOpacity onPress={() => setShowHistory(false)} style={{ padding: 8, backgroundColor: '#f1f5f9', borderRadius: 20 }}>
              <X color="#64748b" size={24} />
            </TouchableOpacity>
          </View>

          <FlatList
            data={historyOrders}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: 20 }}
            ListEmptyComponent={<Text style={{ textAlign: 'center', color: '#94a3b8', marginTop: 40, fontWeight: '800' }}>No deliveries completed today yet.</Text>}
            renderItem={({ item }) => (
              <View style={{ backgroundColor: '#fff', padding: 20, borderRadius: 20, marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, fontWeight: '900', color: '#64748b', marginBottom: 4 }}>#{item.id.split('-')[0].toUpperCase()}</Text>
                  <Text style={{ fontSize: 14, fontWeight: '800', color: '#0f172a' }} numberOfLines={1}>{item.delivery_address}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: 12, fontWeight: '900', color: '#0f766e' }}>{Number.isFinite(Number(item.delivery_fee)) && Number(item.delivery_fee) > 0 ? `Recorded fee: ₹${item.delivery_fee}` : 'Fee not recorded'}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                    <CheckCircle2 size={12} color={item.payout_status === 'PAID' ? "#10b981" : "#f59e0b"} />
                    <Text style={{ fontSize: 10, fontWeight: '800', color: item.payout_status === 'PAID' ? "#10b981" : "#f59e0b", marginLeft: 4 }}>
                      {item.payout_status === 'PAID' ? 'PAID OUT' : 'PENDING PAY'}
                    </Text>
                  </View>
                </View>
              </View>
            )}
          />
        </View>
      </Modal>

    </View>
  );
}
