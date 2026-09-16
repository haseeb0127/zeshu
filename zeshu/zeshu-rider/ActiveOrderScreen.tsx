import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Alert, ActivityIndicator, Linking, ScrollView, Platform } from 'react-native';
import { supabase } from './supabase';
import { MapPin, Phone, Navigation, CheckCircle2, ChevronLeft, ShoppingBag } from 'lucide-react-native';

export default function ActiveOrderScreen({ route, navigation }: any) {
  const { order, riderId } = route.params;
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(order.status || 'PENDING');
  const hasDestinationCoordinates = Number.isFinite(Number(order.delivery_latitude))
    && Number(order.delivery_latitude) >= -90
    && Number(order.delivery_latitude) <= 90
    && Number.isFinite(Number(order.delivery_longitude))
    && Number(order.delivery_longitude) >= -180
    && Number(order.delivery_longitude) <= 180;
  let items: any[] = [];
  try { items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items || []; } catch { items = []; }

  const debugLog = (...details: unknown[]) => {
    if (typeof __DEV__ !== 'undefined' && __DEV__) console.log('[Rider delivery]', ...details);
  };

  const debugError = (...details: unknown[]) => {
    if (typeof __DEV__ !== 'undefined' && __DEV__) console.error('[Rider delivery]', ...details);
  };

  // 🗺️ 1. Open Google Maps (FIXED URL)
  const openMaps = () => {
    if (!hasDestinationCoordinates) return;
    const address = encodeURIComponent(`${Number(order.delivery_latitude)},${Number(order.delivery_longitude)}`);
    const mapUrl = Platform.OS === 'web'
      ? `https://www.google.com/maps/search/?api=1&query=${address}`
      : Platform.OS === 'ios'
        ? `https://maps.apple.com/?q=${address}`
        : `geo:0,0?q=${address}`;
    Linking.openURL(mapUrl).catch(() => Alert.alert('Error', 'Could not open Google Maps'));
  };

  // ✅ 3. Mark as Delivered
  const advanceOrderStatus = async (nextStatus: 'PICKED_UP' | 'OUT_FOR_DELIVERY' | 'DELIVERED') => {
    if (loading) return;
    setLoading(true);
    try {
      debugLog('RPC starting', { orderId: order.id, nextStatus });
      const { data, error } = await supabase.rpc('advance_rider_order_status', {
        p_order_id: order.id,
        p_next_status: nextStatus,
      });
      debugLog('RPC result', { orderId: order.id, nextStatus, success: !error });

      if (error) {
        debugError('Rider order transition failed:', error);
        Alert.alert('Could not update delivery', 'Please check the current order status and try again.');
        return;
      }

      const { data: refreshedOrder, error: refreshError } = await supabase
        .from('orders')
        .select('id,status')
        .eq('id', order.id)
        .eq('rider_id', riderId)
        .maybeSingle();
      if (refreshError) debugError('Rider order refresh failed:', refreshError);
      debugLog('Refresh after success', { orderId: order.id, status: refreshedOrder?.status || data || nextStatus });
      setStatus(refreshedOrder?.status || data || nextStatus);

      if (nextStatus === 'DELIVERED') {
        if (Platform.OS === 'web') {
          const browser = globalThis as typeof globalThis & { alert?: (message: string) => void };
          browser.alert?.('Delivery complete. The order was marked as delivered.');
          navigation.goBack();
        } else {
          Alert.alert('Delivery complete', 'The order was marked as delivered.', [{ text: 'Done', onPress: () => navigation.goBack() }]);
        }
      }
    } catch (error) {
      debugError('Caught error while advancing rider order:', error);
      Alert.alert('Could not update delivery', 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const confirmCompletion = () => {
    debugLog('Complete Delivery button pressed', { orderId: order.id });

    if (Platform.OS === 'web') {
      const browser = globalThis as typeof globalThis & { confirm?: (message: string) => boolean };
      const confirmed = browser.confirm?.('Have you handed the items to the customer?') ?? false;
      debugLog(confirmed ? 'Confirmation accepted' : 'Confirmation cancelled', { orderId: order.id });
      if (confirmed) void advanceOrderStatus('DELIVERED');
      return;
    }

    Alert.alert('Confirm delivery', 'Have you handed the items to the customer?', [
      { text: 'Cancel', style: 'cancel', onPress: () => debugLog('Confirmation cancelled', { orderId: order.id }) },
      { text: 'Complete delivery', onPress: () => { debugLog('Confirmation accepted', { orderId: order.id }); void advanceOrderStatus('DELIVERED'); } },
    ]);
  };

  const nextAction = status === 'READY_FOR_PICKUP'
    ? { label: 'Confirm Pickup', nextStatus: 'PICKED_UP' as const }
    : status === 'PICKED_UP'
      ? { label: 'Start Delivery', nextStatus: 'OUT_FOR_DELIVERY' as const }
      : status === 'OUT_FOR_DELIVERY'
        ? { label: 'Complete Delivery', nextStatus: 'DELIVERED' as const }
        : null;

  return (
    <View style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      
      {/* HEADER */}
      <View style={{ backgroundColor: '#0f172a', paddingTop: 60, paddingBottom: 20, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center' }}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 8, backgroundColor: '#1e293b', borderRadius: 12, marginRight: 16 }}>
          <ChevronLeft color="#fff" size={24} />
        </TouchableOpacity>
        <Text style={{ color: '#fff', fontSize: 20, fontWeight: '900', letterSpacing: 1 }}>ORDER DETAILS</Text>
      </View>

      <ScrollView style={{ flex: 1, padding: 20 }} showsVerticalScrollIndicator={false}>
        
        {/* ORDER ID & AMOUNT */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', padding: 20, borderRadius: 20, marginBottom: 16, borderWidth: 1, borderColor: '#e2e8f0' }}>
          <View>
            <Text style={{ fontSize: 12, fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>Order ID</Text>
            <Text style={{ fontSize: 18, fontWeight: '900', color: '#0f172a' }}>#{order.id.split('-')[0].toUpperCase()}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
             <Text style={{ fontSize: 12, fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>Delivery Status</Text>
             <Text style={{ fontSize: 14, fontWeight: '900', color: '#087443' }}>{status.replaceAll('_', ' ')}</Text>
          </View>
        </View>

        {/* CUSTOMER & LOCATION */}
        <View style={{ backgroundColor: '#fff', padding: 20, borderRadius: 20, marginBottom: 16, borderWidth: 1, borderColor: '#e2e8f0' }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 24 }}>
            <MapPin color="#3b82f6" size={24} style={{ marginRight: 16, marginTop: 2 }} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>Drop Location</Text>
              <Text style={{ fontSize: 18, fontWeight: '800', color: '#0f172a', lineHeight: 24 }}>{order.delivery_address}</Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: 12 }}>
            {hasDestinationCoordinates ? <TouchableOpacity onPress={openMaps} style={{ flex: 1, backgroundColor: '#eff6ff', padding: 16, borderRadius: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#bfdbfe' }}>
              <Navigation color="#3b82f6" size={20} style={{ marginRight: 8 }} />
              <Text style={{ color: '#3b82f6', fontSize: 14, fontWeight: '900' }}>Navigate</Text>
            </TouchableOpacity> : null}
            
            <TouchableOpacity disabled style={{ flex: hasDestinationCoordinates ? 1 : undefined, opacity: 0.55, backgroundColor: '#f0fdf4', padding: 16, borderRadius: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#bbf7d0' }}>
              <Phone color="#16a34a" size={20} style={{ marginRight: 8 }} />
              <Text style={{ color: '#16a34a', fontSize: 14, fontWeight: '900' }}>Call unavailable</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ITEMS LIST (Now safely includes the Weight and Quantity display) */}
        <View style={{ backgroundColor: '#fff', padding: 20, borderRadius: 20, marginBottom: 100, borderWidth: 1, borderColor: '#e2e8f0' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
            <ShoppingBag color="#0f172a" size={20} style={{ marginRight: 8 }} />
            <Text style={{ fontSize: 16, fontWeight: '900', color: '#0f172a' }}>Order Items</Text>
          </View>
          
          {items.length === 0 ? <Text style={{ color: '#64748b', fontWeight: '700' }}>Item details are unavailable for this order.</Text> : items.map((i: any, idx: number) => (
            <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
              <View>
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#334155' }}>{i.qty}x   {i.item.name}</Text>
                <Text style={{ fontSize: 12, color: '#94a3b8' }}>Weight: {i.item.weight || 'N/A'}</Text>
              </View>
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#94a3b8' }}>{i.item.unit}</Text>
            </View>
          ))}
        </View>

      </ScrollView>

      {/* DELIVERY BUTTON */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e2e8f0' }}>
        {nextAction ? <TouchableOpacity onPress={() => {
          if (nextAction.nextStatus === 'DELIVERED') {
            confirmCompletion();
          } else {
            debugLog('Lifecycle button pressed', { orderId: order.id, nextStatus: nextAction.nextStatus });
            void advanceOrderStatus(nextAction.nextStatus);
          }
        }} disabled={loading} style={{ opacity: loading ? 0.65 : 1, backgroundColor: '#087443', height: 64, borderRadius: 20, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', elevation: 5 }}>
          {loading ? <ActivityIndicator color="#fff" /> : <><CheckCircle2 color="#fff" size={24} style={{ marginRight: 12 }} /><Text style={{ color: '#fff', fontSize: 18, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 }}>{nextAction.label}</Text></>}
        </TouchableOpacity> : <View style={{ minHeight: 64, borderRadius: 20, backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 }}><Text style={{ color: '#475569', textAlign: 'center', fontWeight: '800' }}>{status === 'DELIVERED' ? 'This delivery is complete.' : 'This order is awaiting the next dispatch status.'}</Text></View>}
      </View>

    </View>
  );
}
