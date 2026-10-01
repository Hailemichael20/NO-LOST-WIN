import React, { useState } from 'react';
import { auth, db } from '../firebaseConfig';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { uploadReceiptImage } from '../cloudinaryUpload';

export default function UploadReceipt() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!auth || !db) {
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
      const receiptUrl = await uploadReceiptImage(file, setProgress);
      await addDoc(collection(db, 'entries'), {
        userId: auth.currentUser.uid,
        email: auth.currentUser.email,
        receiptUrl,
        status: 'pending',
        createdAt: serverTimestamp(),
      });
      alert('Receipt uploaded and saved successfully!');
    } catch (error) {
      console.error('Receipt upload failed:', error);
      setError(error.message || 'Receipt upload failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <h3>Upload Receipt</h3>
      <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} disabled={loading} />
      {loading && <p>Uploading receipt... {progress}%</p>}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
    </div>
  );
}