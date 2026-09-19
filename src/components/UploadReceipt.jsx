import React, { useState } from 'react';
import { auth, db, storage } from '../firebaseConfig';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';

export default function UploadReceipt() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!auth || !db || !storage) {
      setError('Firebase is not configured correctly. Please configure the app settings and reload the page.');
      return;
    }
    if (!auth.currentUser) {
      setError('Please sign in before uploading a receipt.');
      return;
    }

    setLoading(true);
    setError('');
    setProgress(0);

    try {
      const extension = file.name.split('.').pop() || 'jpg';
      const storageRef = ref(storage, `receipts/${auth.currentUser.uid}/${Date.now()}.${extension}`);
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on(
        'state_changed',
        (snapshot) => setProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)),
        (uploadError) => {
          console.error('Upload failed:', uploadError);
          setError('Receipt upload failed. Please try again.');
          setLoading(false);
        },
        async () => {
          try {
            const receiptUrl = await getDownloadURL(uploadTask.snapshot.ref);
            await addDoc(collection(db, 'entries'), {
              userId: auth.currentUser.uid,
              email: auth.currentUser.email,
              receiptUrl,
              status: 'pending',
              createdAt: serverTimestamp(),
            });
            alert('Receipt uploaded and saved successfully!');
          } catch (submitError) {
            console.error('Save failed:', submitError);
            setError('Receipt uploaded but could not be saved.');
          } finally {
            setLoading(false);
          }
        }
      );
    } catch (error) {
      console.error('Error uploading receipt:', error);
      setError('Upload failed. Check the browser console for details.');
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <h3>Upload Receipt</h3>
      <input type="file" accept="image/*" onChange={handleFileChange} disabled={loading} />
      {loading && <p>Uploading receipt... {progress}%</p>}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
    </div>
  );
}