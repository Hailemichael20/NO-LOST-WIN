import React, { useState } from 'react';
import { db, storage } from '../firebaseConfig'; // Ensure your firebaseConfig is initialized
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';

const TIERS = [
  { amount: 50, label: '50 Birr Entry', color: 'border-blue-500 hover:bg-blue-50' },
  { amount: 100, label: '100 Birr Entry', color: 'border-green-500 hover:bg-green-50' },
  { amount: 300, label: '300 Birr Entry', color: 'border-purple-500 hover:bg-purple-50' },
  { amount: 500, label: '500 Birr Entry', color: 'border-amber-500 hover:bg-amber-50' },
];

export default function LotteryRegistration() {
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [selectedTier, setSelectedTier] = useState(100);
  const [receiptFile, setReceiptFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState('');

  // Handle Receipt File Selection
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file (JPG, PNG).');
      return;
    }

    if (file.size > 5 * 1024 * 1024) { // 5MB Limit
      setError('File size must be under 5MB.');
      return;
    }

    setError('');
    setReceiptFile(file);
    setFilePreview(URL.createObjectURL(file));
  };

  // Submit Handler
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!fullName || !phoneNumber || !receiptFile) {
      setError('Please fill in all fields and upload your payment receipt.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      // 1. Storage Reference with Unique Filename
      const fileExtension = receiptFile.name.split('.').pop();
      const fileName = `receipts/${Date.now()}_${phoneNumber}.${fileExtension}`;
      const storageRef = ref(storage, fileName);

      // 2. Upload Task with Progress Monitoring
      const uploadTask = uploadBytesResumable(storageRef, receiptFile);

      uploadTask.on(
        'state_changed',
        (snapshot) => {
          const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          setUploadProgress(progress);
        },
        (err) => {
          console.error(err);
          setError('Failed to upload receipt. Please check your connection.');
          setIsSubmitting(false);
        },
        async () => {
          // 3. Get Download URL once uploaded
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);

          // 4. Save Entry to Firestore "entries" Collection
          await addDoc(collection(db, 'entries'), {
            fullName,
            phone: phoneNumber,
            tier: selectedTier,
            receiptUrl: downloadURL,
            status: 'pending', // Pending Admin Verification
            telegramJoined: false,
            createdAt: serverTimestamp(),
          });

          setIsSubmitting(false);
          setIsSuccess(true);
        }
      );
    } catch (err) {
      console.error(err);
      setError('An error occurred during submission. Try again.');
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="max-w-md mx-auto my-8 p-6 bg-white rounded-2xl shadow-xl text-center border border-green-200">
        <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold">
          ✓
        </div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Registration Submitted!</h2>
        <p className="text-gray-600 text-sm mb-6">
          Your payment receipt for <span className="font-semibold">{selectedTier} Birr</span> is under verification by our team.
        </p>
        <p className="text-xs text-gray-500 mb-4">
          Once approved, you will get access to the official live rotation channel.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto my-8 p-6 bg-white rounded-2xl shadow-lg border border-gray-100">
      <h2 className="text-2xl font-bold text-gray-800 text-center mb-1">Enter the Draw</h2>
      <p className="text-gray-500 text-center text-sm mb-6">Select your entry tier & upload payment confirmation</p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Step 1: Contact Details */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Full Name</label>
            <input
              type="text"
              required
              placeholder="e.g. Abebe Bikila"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Phone Number (Telebirr / Mobile)</label>
            <input
              type="tel"
              required
              placeholder="0912345678"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
            />
          </div>
        </div>

        {/* Step 2: Select Birr Tier */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Select Category Tier</label>
          <div className="grid grid-cols-2 gap-3">
            {TIERS.map((tier) => (
              <button
                key={tier.amount}
                type="button"
                onClick={() => setSelectedTier(tier.amount)}
                className={`p-3 rounded-xl border-2 text-center transition font-semibold text-sm ${
                  selectedTier === tier.amount
                    ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm'
                    : 'border-gray-100 bg-gray-50 text-gray-700 hover:border-gray-300'
                }`}
              >
                {tier.label}
              </button>
            ))}
          </div>
        </div>

        {/* Step 3: Payment Instruction Banner */}
        <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-800">
          <p className="font-bold mb-1">Payment Instructions:</p>
          <p>Transfer <span className="font-bold text-amber-900">{selectedTier} Birr</span> to:</p>
          <ul className="list-disc pl-4 mt-1 space-y-0.5">
            <li>Telebirr: <span className="font-mono font-bold">0911XXXXXX</span></li>
            <li>CBE: <span className="font-mono font-bold">1000XXXXXXXXX</span></li>
          </ul>
        </div>

        {/* Step 4: Receipt File Upload */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Upload Payment Receipt Screenshot</label>
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="w-full text-sm text-gray-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 transition cursor-pointer"
          />

          {filePreview && (
            <div className="mt-3 relative w-full h-40 rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
              <img src={filePreview} alt="Receipt preview" className="w-full h-full object-contain" />
            </div>
          )}
        </div>

        {/* Progress Bar during Upload */}
        {isSubmitting && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-gray-500">
              <span>Uploading Receipt...</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-blue-600 h-2 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
            </div>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isSubmitting}
          className={`w-full py-3.5 px-4 rounded-xl font-bold text-white transition shadow-md ${
            isSubmitting ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 active:scale-[0.99]'
          }`}
        >
          {isSubmitting ? 'Submitting Entry...' : `Submit Entry (${selectedTier} Birr)`}
        </button>
      </form>
    </div>
  );
}