import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Alert, ActivityIndicator, Linking, ScrollView } from 'react-native';
import { supabase } from './supabase';
import { MapPin, Phone, Navigation, CheckCircle2, ChevronLeft, ShoppingBag } from 'lucide-react-native';

export default function ActiveOrderScreen({ route, navigation }: any) {
  const { order } = route.params;
  const [loading, setLoading] = useState(false);

  // 🗺️ 1. Open Google Maps (FIXED URL)
  const openMaps = () => {
    const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.delivery_address)}`;
    Linking.openURL(mapUrl).catch(() => Alert.alert('Error', 'Could not open Google Maps'));
  };

  // 📞 2. Call the Customer
  const callCustomer = () => {
    const phoneNumber = '+919876543210'; // Placeholder
    Linking.openURL(`tel:${phoneNumber}`);
  };

  // ✅ 3. Mark as Delivered
  const markAsDelivered = async () => {
    Alert.alert(
      "Confirm Delivery",
      "Are you sure you have handed the items to the customer?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Yes, Delivered!", 
          onPress: async () => {
            setLoading(true);
            
            // This updates the status to DELIVERED
            // This will trigger the real-time listener on your Dashboard!
            const { error } = await supabase
              .from('orders')
              .update({ status: 'DELIVERED' })
              .eq('id', order.id);

            setLoading(false);

            if (error) {
              Alert.alert('Error', 'Could not update status.');
            } else {
              Alert.alert('Success!', 'Great job. You earned ₹30 for this delivery.');
              navigation.goBack(); 
            }
          }
        }
      ]
    );
  };

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
             <Text style={{ fontSize: 12, fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>To Collect</Text>
             <Text style={{ fontSize: 18, fontWeight: '900', color: '#10b981' }}>PAID ONLINE</Text>
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
            <TouchableOpacity onPress={openMaps} style={{ flex: 1, backgroundColor: '#eff6ff', padding: 16, borderRadius: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#bfdbfe' }}>
              <Navigation color="#3b82f6" size={20} style={{ marginRight: 8 }} />
              <Text style={{ color: '#3b82f6', fontSize: 14, fontWeight: '900' }}>Navigate</Text>
            </TouchableOpacity>
            
            <TouchableOpacity onPress={callCustomer} style={{ flex: 1, backgroundColor: '#f0fdf4', padding: 16, borderRadius: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#bbf7d0' }}>
              <Phone color="#16a34a" size={20} style={{ marginRight: 8 }} />
              <Text style={{ color: '#16a34a', fontSize: 14, fontWeight: '900' }}>Call</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ITEMS LIST (Now safely includes the Weight and Quantity display) */}
        <View style={{ backgroundColor: '#fff', padding: 20, borderRadius: 20, marginBottom: 100, borderWidth: 1, borderColor: '#e2e8f0' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
            <ShoppingBag color="#0f172a" size={20} style={{ marginRight: 8 }} />
            <Text style={{ fontSize: 16, fontWeight: '900', color: '#0f172a' }}>Order Items</Text>
          </View>
          
          {order.items?.map((i: any, idx: number) => (
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
        <TouchableOpacity 
          onPress={markAsDelivered}
          disabled={loading}
          style={{ backgroundColor: '#10b981', height: 64, borderRadius: 20, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', elevation: 5 }}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <CheckCircle2 color="#fff" size={24} style={{ marginRight: 12 }} />
              <Text style={{ color: '#fff', fontSize: 18, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 }}>Slide to Deliver</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

    </View>
  );
}