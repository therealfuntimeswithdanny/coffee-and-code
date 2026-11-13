import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';

const PostView = ({ post }) => {
  const navigation = useNavigation();

  const handleProfilePress = () => {
    navigation.navigate('Profile', { userId: post.authorId });
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Image source={{ uri: post.authorProfilePhoto }} style={styles.profilePhoto} />
        <Text style={styles.authorName}>{post.authorName}</Text>
        <Text style={styles.bio}>{post.authorBio}</Text>
      </View>
      <Text style={styles.date}>{post.date}</Text>
      <Text style={styles.content}>{post.content}</Text>
      <View style={styles.footer}>
        <Text style={styles.footerText}>Coffee & Code</Text>
        <TouchableOpacity onPress={handleProfilePress} style={styles.profileButton} testID="profileButton">
          <Text style={styles.profileButtonText}>View Profile</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  profilePhoto: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 16,
  },
  authorName: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  bio: {
    fontSize: 14,
    color: '#666',
  },
  date: {
    fontSize: 12,
    color: '#999',
    marginBottom: 8,
  },
  content: {
    fontSize: 16,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
  },
  footerText: {
    fontSize: 14,
    color: '#666',
    marginRight: 8,
  },
  profileButton: {
    backgroundColor: '#007bff',
    padding: 8,
    borderRadius: 4,
  },
  profileButtonText: {
    color: '#fff',
    fontSize: 14,
  },
});

export default PostView;
