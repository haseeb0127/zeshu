import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, FlatList, ActivityIndicator, Alert, Modal } from 'react-native';
import { supabase } from './supabase';
import { MapPin, Navigation, Power, IndianRupee, History, X, CheckCircle2 } from 'lucide-react-native';

export default function DashboardScreen({ navigation }: any) {
  const [isOnline, setIsOnline] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);
  const [historyOrders, setHistoryOrders] = useState<any[]>([]); 
  const [totalEarnings, setTotalEarnings] = useState(0); 
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false); 
  const [userId, setUserId] = useState<string | null>(null);

  // 1. Get the Rider's ID
  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setUserId(user.id);
    };
    getUser();
  }, []);

  // 2. Real-time Engine
  useEffect(() => {
    if (!userId || !isOnline) {
      setOrders([]);
      return;
    }

    fetchMyOrders();

    const channel = supabase
      .channel('rider-live-feed')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `assigned_rider_id=eq.${userId}` },
        () => { fetchMyOrders(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId, isOnline]);

  // 3. Unified Fetch (Active + History + Earnings)
  const fetchMyOrders = async () => {
    if (!userId) return;
    setLoading(true);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0); 

    const { data, error } = await supabase
      .from('orders')
      .select('id, status, delivery_address, delivery_fee, created_at, payout_status')
      .eq('assigned_rider_id', userId)
      .gte('created_at', today.toISOString())
      .order('created_at', { ascending: false });

    if (data) {
      // Set Active Orders
      const active = data.filter(o => o.status === 'PENDING' || o.status === 'OUT_FOR_DELIVERY');
      setOrders(active);

      // Set History Orders
      const delivered = data.filter(o => o.status?.toUpperCase() === 'DELIVERED');
      setHistoryOrders(delivered);

      // Calculate Today's Earnings
      const earnings = delivered.reduce((sum, order) => sum + (parseFloat(order.delivery_fee) || 30), 0);
      setTotalEarnings(earnings);
    }
    setLoading(false);
  };

  const handleToggleDuty = () => setIsOnline(!isOnline);
  const navigateToOrder = (order: any) => navigation.navigate('ActiveOrder', { order });

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
              <Text style={{ color: '#10b981', fontWeight: '900', marginLeft: 4 }}>Today: ₹{totalEarnings}</Text>
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
          style={{ marginTop: 20, height: 70, backgroundColor: isOnline ? '#ef4444' : '#10b981', borderRadius: 20, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', elevation: 10 }}
        >
          <Power color="#fff" size={28} style={{ marginRight: 12 }} />
          <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900', textTransform: 'uppercase' }}>
            {isOnline ? 'Go Offline' : 'Go Online'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* --- ACTIVE ORDERS LIST --- */}
      <View style={{ flex: 1, padding: 20 }}>
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
                  <Text style={{ fontSize: 20, fontWeight: '900', color: '#10b981' }}>₹{item.delivery_fee || 30}</Text>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 20 }}>
                  <MapPin color="#0f172a" size={24} style={{ marginRight: 12 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase' }}>Drop Location</Text>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: '#0f172a' }}>{item.delivery_address}</Text>
                  </View>
                </View>

                <View style={{ backgroundColor: '#0f172a', padding: 16, borderRadius: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: 16, fontWeight: '900', marginRight: 8 }}>View Details</Text>
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
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#10b981' }}>Total Earned: ₹{totalEarnings}</Text>
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
                  <Text style={{ fontSize: 18, fontWeight: '900', color: '#10b981' }}>+₹{item.delivery_fee || 30}</Text>
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