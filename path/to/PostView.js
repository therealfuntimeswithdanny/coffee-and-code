import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
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
        <TouchableOpacity onPress={handleProfilePress} style={styles.profileButton}>
          <Text style={styles.profileButtonText}>View Profile</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profilePhoto: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 10,
  },
  authorName: {
    fontSize: 18,
    fontWeight: 'bold',
    marginRight: 10,
  },
  bio: {
    fontSize: 14,
    color: '#666',
  },
  date: {
    fontSize: 14,
    color: '#666',
    marginTop: 10,
  },
  content: {
    fontSize: 16,
    marginTop: 10,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  footerText: {
    fontSize: 14,
    color: '#666',
  },
  profileButton: {
    backgroundColor: '#007bff',
    padding: 10,
    borderRadius: 5,
  },
  profileButtonText: {
    color: '#fff',
    fontSize: 14,
  },
});

export default PostView;
