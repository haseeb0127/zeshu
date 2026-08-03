import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { supabase } from './supabase';
import { Smartphone, Lock } from 'lucide-react-native';

export default function LoginScreen({ navigation }: any) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);

  // 🚀 1. Send the OTP
  const sendOtp = async () => {
    if (phoneNumber.length !== 10) {
      Alert.alert('Invalid Number', 'Please enter a valid 10-digit mobile number.');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      phone: `+91${phoneNumber}`,
    });
    setLoading(false);

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setIsOtpSent(true);
    }
  };

  // 🔑 2. Verify the OTP
  const verifyOtp = async () => {
    if (otp.length !== 6) {
      Alert.alert('Invalid OTP', 'Please enter the 6-digit OTP.');
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.auth.verifyOtp({
      phone: `+91${phoneNumber}`,
      token: otp,
      type: 'sms',
    });
    setLoading(false);

    if (error) {
      Alert.alert('Verification Failed', error.message);
    } else if (data.session) {
      // Success! Navigate to the Dashboard
      navigation.replace('Dashboard');
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: '#f8fafc', justifyContent: 'center', padding: 24 }}
    >
      <View style={{ alignItems: 'center', marginBottom: 40 }}>
        <View style={{ backgroundColor: '#000', padding: 16, borderRadius: 20, marginBottom: 16 }}>
          <Text style={{ color: '#fff', fontSize: 32, fontWeight: '900', letterSpacing: 2 }}>ZESHU</Text>
        </View>
        <Text style={{ fontSize: 24, fontWeight: '900', color: '#0f172a' }}>Rider Partner App</Text>
        <Text style={{ fontSize: 14, color: '#64748b', marginTop: 8 }}>Login to view your deliveries</Text>
      </View>

      {!isOtpSent ? (
        // --- PHONE NUMBER INPUT ---
        <View>
          <Text style={{ fontSize: 12, fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 8, marginLeft: 4 }}>
            Mobile Number
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 2, borderColor: '#e2e8f0', borderRadius: 16, paddingHorizontal: 16, height: 64, marginBottom: 24 }}>
            <Smartphone color="#94a3b8" size={24} />
            <Text style={{ fontSize: 20, fontWeight: '800', color: '#0f172a', marginLeft: 12, marginRight: 8 }}>+91</Text>
            <TextInput
              style={{ flex: 1, fontSize: 20, fontWeight: '800', color: '#0f172a' }}
              placeholder="00000 00000"
              keyboardType="number-pad"
              maxLength={10}
              value={phoneNumber}
              onChangeText={setPhoneNumber}
            />
          </View>

          <TouchableOpacity 
            onPress={sendOtp} 
            disabled={loading || phoneNumber.length !== 10}
            style={{ backgroundColor: phoneNumber.length === 10 ? '#000' : '#cbd5e1', height: 64, borderRadius: 16, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 5 }}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 16, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 }}>Send OTP</Text>}
          </TouchableOpacity>
        </View>
      ) : (
        // --- OTP VERIFICATION INPUT ---
        <View>
           <Text style={{ fontSize: 12, fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 8, marginLeft: 4 }}>
            Enter 6-Digit OTP
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 2, borderColor: '#8b5cf6', borderRadius: 16, paddingHorizontal: 16, height: 64, marginBottom: 24 }}>
            <Lock color="#8b5cf6" size={24} />
            <TextInput
              style={{ flex: 1, fontSize: 24, fontWeight: '900', color: '#0f172a', marginLeft: 16, letterSpacing: 8 }}
              placeholder="------"
              keyboardType="number-pad"
              maxLength={6}
              value={otp}
              onChangeText={setOtp}
              autoFocus
            />
          </View>

          <TouchableOpacity 
            onPress={verifyOtp} 
            disabled={loading || otp.length !== 6}
            style={{ backgroundColor: otp.length === 6 ? '#8b5cf6' : '#c4b5fd', height: 64, borderRadius: 16, justifyContent: 'center', alignItems: 'center', shadowColor: '#8b5cf6', shadowOpacity: 0.3, shadowRadius: 10, elevation: 5 }}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 16, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 }}>Verify & Login</Text>}
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}