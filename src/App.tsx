import React, { useState } from 'react';
import { Upload, FileSpreadsheet, Download, AlertCircle, CheckCircle, FileText, Loader2, FolderOpen, X, Image } from 'lucide-react';
import * as XLSX from 'xlsx';

const PdfImageBatchOcrToExcel = () => {
  const [files, setFiles] = useState([]);
  const [processedFiles, setProcessedFiles] = useState([]);
  const [currentProcessing, setCurrentProcessing] = useState(null);
  const [status, setStatus] = useState('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const ACCEPTED_TYPES = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg,.jpeg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
    'image/tiff': '.tiff'
  };

  const isAcceptedFile = (file) => {
    return Object.keys(ACCEPTED_TYPES).includes(file.type);
  };

  const handleFolderUpload = async (event) => {
    const fileList = Array.from(event.target.files || []);
    const acceptedFiles = fileList.filter(isAcceptedFile);

    if (acceptedFiles.length === 0) {
      setStatus('error');
      setErrorMessage('対応ファイルが見つかりませんでした（PDF, JPG, PNG, GIF, WEBP, BMP, TIFF）');
      return;
    }

    setFiles(acceptedFiles);
    setProcessedFiles([]);
    setStatus('idle');
    setErrorMessage('');
  };

  const handleFileUpload = async (event) => {
    const fileList = Array.from(event.target.files || []);
    const acceptedFiles = fileList.filter(isAcceptedFile);

    if (acceptedFiles.length === 0) {
      setStatus('error');
      setErrorMessage('対応ファイルを選択してください（PDF, JPG, PNG, GIF, WEBP, BMP, TIFF）');
      return;
    }

    setFiles(acceptedFiles);
    setProcessedFiles([]);
    setStatus('idle');
    setErrorMessage('');
  };

  const processAllFiles = async () => {
    if (files.length === 0) return;

    setStatus('processing');
    setProgress({ current: 0, total: files.length });
    setProcessedFiles([]);
    setErrorMessage('');

    const results = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setCurrentProcessing(file.name);
      setProgress({ current: i + 1, total: files.length });

      try {
        const base64Data = await fileToBase64(file);
        const ocrResult = await callClaudeOcr(base64Data, file);
        const tableData = parseOcrResult(ocrResult);

        results.push({
          fileName: file.name,
          fileType: file.type,
          status: 'success',
          data: tableData,
          error: null
        });
      } catch (error) {
        results.push({
          fileName: file.name,
          fileType: file.type,
          status: 'error',
          data: null,
          error: error.message
        });
      }
    }

    setProcessedFiles(results);
    setCurrentProcessing(null);
    setStatus('completed');
  };

  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64String = reader.result.split(',')[1];
        resolve(base64String);
      };
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(file);
    });
  };

  const getMediaType = (file) => {
    if (file.type === 'application/pdf') {
      return 'application/pdf';
    }
    // 画像ファイルの場合
    return file.type;
  };

  const getContentType = (file) => {
    if (file.type === 'application/pdf') {
      return 'document';
    }
    return 'image';
  };

  const callClaudeOcr = async (base64Data, file) => {
    const mediaType = getMediaType(file);
    const contentType = getContentType(file);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: contentType,
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64Data
                }
              },
              {
                type: 'text',
                text: `この${contentType === 'document' ? 'PDF' : '画像'}ファイル「${file.name}」から文字と数字の情報を全て抽出してください。

以下のルールに従ってください：
1. 表がある場合は、表の構造を維持してください
2. 文字と数字のみを抽出（装飾や図形は除外）
3. 日本語、英語、数字を正確に認識してください
4. レシート、請求書、帳票などの場合は項目と値を適切に抽出
5. 出力はJSON形式のみで、マークダウンや説明は不要です

JSON形式：
{
  "headers": ["列1", "列2", "列3", ...],
  "rows": [
    ["値1-1", "値1-2", "値1-3", ...],
    ["値2-1", "値2-2", "値2-3", ...],
    ...
  ]
}

表がない場合や単純なテキストの場合：
{
  "headers": ["項目", "内容"],
  "rows": [
    ["項目1", "値1"],
    ["項目2", "値2"],
    ...
  ]
}`
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API Error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.content || data.content.length === 0) {
      throw new Error('APIから応答がありませんでした');
    }

    return data.content;
  };

  const parseOcrResult = (content) => {
    try {
      const textContent = content
        .filter(item => item.type === 'text')
        .map(item => item.text)
        .join('\n');

      const cleanJson = textContent
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const parsed = JSON.parse(cleanJson);

      const tableArray = [
        parsed.headers || ['項目', '内容'],
        ...(parsed.rows || [])
      ];

      if (tableArray.length <= 1) {
        throw new Error('抽出されたデータがありません');
      }

      return tableArray;
    } catch (error) {
      throw new Error(`データの解析に失敗: ${error.message}`);
    }
  };

  const downloadSingleExcel = (fileData) => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(fileData.data);

    const colWidths = fileData.data[0].map((_, colIndex) => {
      const maxLength = Math.max(
        ...fileData.data.map(row => 
          row[colIndex] ? String(row[colIndex]).length : 0
        )
      );
      return { wch: Math.min(maxLength + 2, 50) };
    });
    ws['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, 'OCR抽出データ');

    const fileName = fileData.fileName
      .replace(/\.(pdf|jpg|jpeg|png|gif|webp|bmp|tiff)$/i, '_OCR.xlsx');
    XLSX.writeFile(wb, fileName);
  };

  const downloadAllExcel = () => {
    const successFiles = processedFiles.filter(f => f.status === 'success');
    
    if (successFiles.length === 0) return;

    const wb = XLSX.utils.book_new();

    successFiles.forEach((fileData, index) => {
      const ws = XLSX.utils.aoa_to_sheet(fileData.data);

      const colWidths = fileData.data[0].map((_, colIndex) => {
        const maxLength = Math.max(
          ...fileData.data.map(row => 
            row[colIndex] ? String(row[colIndex]).length : 0
          )
        );
        return { wch: Math.min(maxLength + 2, 50) };
      });
      ws['!cols'] = colWidths;

      const sheetName = fileData.fileName
        .replace(/\.(pdf|jpg|jpeg|png|gif|webp|bmp|tiff)$/i, '')
        .substring(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });

    XLSX.writeFile(wb, 'all_ocr_data.xlsx');
  };

  const removeFile = (index) => {
    const newFiles = files.filter((_, i) => i !== index);
    setFiles(newFiles);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();

    const fileList = Array.from(e.dataTransfer.files);
    const acceptedFiles = fileList.filter(isAcceptedFile);

    if (acceptedFiles.length > 0) {
      setFiles(acceptedFiles);
      setProcessedFiles([]);
      setStatus('idle');
    }
  };

  const getFileIcon = (fileType) => {
    if (fileType === 'application/pdf') {
      return <FileText className="h-5 w-5 text-red-600" />;
    }
    return <Image className="h-5 w-5 text-blue-600" />;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto">
        {/* ヘッダー */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <div className="relative">
              <FolderOpen className="h-12 w-12 text-indigo-600 mr-3" />
              <Image className="h-6 w-6 text-purple-600 absolute -bottom-1 -right-1" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-800">
              PDF・画像一括OCR to Excel
            </h1>
          </div>
          <p className="text-gray-600 text-sm sm:text-base">
            PDFと画像ファイル（JPG, PNG, GIF, WEBP, BMP, TIFF）を一括でOCR処理し、Excelファイルに変換
          </p>
        </div>

        {/* アップロードエリア */}
        <div 
          className="bg-white rounded-xl shadow-xl p-6 sm:p-8 mb-6"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <div className="border-2 border-dashed border-indigo-300 rounded-xl p-8 sm:p-12 text-center hover:border-indigo-500 hover:bg-indigo-50 transition-all">
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.bmp,.tiff"
              multiple
              webkitdirectory=""
              directory=""
              onChange={handleFolderUpload}
              className="hidden"
              id="folder-upload"
              disabled={status === 'processing'}
            />
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.bmp,.tiff"
              multiple
              onChange={handleFileUpload}
              className="hidden"
              id="file-upload"
              disabled={status === 'processing'}
            />
            <div className="flex justify-center mb-4">
              <FolderOpen className="h-16 w-16 text-indigo-400 mr-2" />
              <Image className="h-16 w-16 text-purple-400" />
            </div>
            <p className="text-lg font-semibold text-gray-700 mb-2">
              PDF・画像ファイルをドラッグ&ドロップ
            </p>
            <p className="text-sm text-gray-500 mb-4">
              対応形式: PDF, JPG, PNG, GIF, WEBP, BMP, TIFF
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <label htmlFor="folder-upload" className="cursor-pointer">
                <span className="bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition-colors inline-block font-medium">
                  📁 フォルダを選択
                </span>
              </label>
              <label htmlFor="file-upload" className="cursor-pointer">
                <span className="bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 transition-colors inline-block font-medium">
                  📄 個別ファイルを選択
                </span>
              </label>
            </div>
          </div>

          {/* ファイルリスト */}
          {files.length > 0 && (
            <div className="mt-6">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-semibold text-gray-800">
                  選択されたファイル ({files.length}件)
                </h3>
                {status === 'idle' && (
                  <button
                    onClick={processAllFiles}
                    className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 transition-colors font-medium"
                  >
                    🚀 一括処理を開始
                  </button>
                )}
              </div>
              <div className="max-h-60 overflow-auto space-y-2">
                {files.map((file, index) => (
                  <div key={index} className="flex items-center justify-between bg-gray-50 p-3 rounded-lg">
                    <div className="flex items-center flex-1 min-w-0">
                      {getFileIcon(file.type)}
                      <span className="text-sm text-gray-700 truncate ml-2">{file.name}</span>
                      <span className="text-xs text-gray-500 ml-2 flex-shrink-0">
                        ({(file.size / 1024).toFixed(1)} KB)
                      </span>
                    </div>
                    {status === 'idle' && (
                      <button
                        onClick={() => removeFile(index)}
                        className="ml-2 text-red-500 hover:text-red-700 flex-shrink-0"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 処理中の表示 */}
        {status === 'processing' && (
          <div className="bg-blue-50 border-l-4 border-blue-500 rounded-lg p-6 mb-6">
            <div className="flex items-start">
              <Loader2 className="animate-spin h-6 w-6 text-blue-600 mr-3 mt-1 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-semibold text-blue-800 mb-2">処理中...</p>
                <p className="text-sm text-blue-700 mb-3">
                  {currentProcessing && `現在処理中: ${currentProcessing}`}
                </p>
                <div className="bg-blue-200 rounded-full h-3 mb-2">
                  <div 
                    className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  ></div>
                </div>
                <p className="text-sm text-blue-700">
                  進捗: {progress.current} / {progress.total} ファイル
                </p>
              </div>
            </div>
          </div>
        )}

        {/* エラー表示 */}
        {status === 'error' && (
          <div className="bg-red-50 border-l-4 border-red-500 rounded-lg p-4 mb-6">
            <div className="flex items-center">
              <AlertCircle className="h-5 w-5 text-red-600 mr-3" />
              <p className="text-red-800">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* 完了表示 */}
        {status === 'completed' && (
          <div className="bg-green-50 border-l-4 border-green-500 rounded-lg p-4 mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <CheckCircle className="h-5 w-5 text-green-600 mr-3" />
                <p className="font-semibold text-green-800">
                  処理完了! ({processedFiles.filter(f => f.status === 'success').length}件成功 / {processedFiles.length}件)
                </p>
              </div>
              {processedFiles.some(f => f.status === 'success') && (
                <button
                  onClick={downloadAllExcel}
                  className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 transition-colors flex items-center font-medium"
                >
                  <Download className="mr-2 h-5 w-5" />
                  全データを1つのExcelに統合
                </button>
              )}
            </div>
          </div>
        )}

        {/* 処理結果リスト */}
        {processedFiles.length > 0 && (
          <div className="bg-white rounded-xl shadow-xl p-6 mb-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center">
              <FileSpreadsheet className="mr-2 h-6 w-6 text-indigo-600" />
              処理結果
            </h2>
            <div className="space-y-3">
              {processedFiles.map((file, index) => (
                <div 
                  key={index} 
                  className={`p-4 rounded-lg border-l-4 ${
                    file.status === 'success' 
                      ? 'bg-green-50 border-green-500' 
                      : 'bg-red-50 border-red-500'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 flex items-center">
                      {getFileIcon(file.fileType)}
                      <div className="ml-2">
                        <p className="font-medium text-gray-800">{file.fileName}</p>
                        {file.status === 'success' && file.data && (
                          <p className="text-sm text-gray-600 mt-1">
                            抽出データ: {file.data.length - 1}行 × {file.data[0].length}列
                          </p>
                        )}
                        {file.status === 'error' && (
                          <p className="text-sm text-red-600 mt-1">エラー: {file.error}</p>
                        )}
                      </div>
                    </div>
                    {file.status === 'success' && (
                      <button
                        onClick={() => downloadSingleExcel(file)}
                        className="ml-4 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors flex items-center text-sm"
                      >
                        <Download className="mr-1 h-4 w-4" />
                        個別DL
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 説明セクション */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-xl shadow-md p-6">
            <div className="bg-indigo-100 rounded-lg p-3 w-12 h-12 flex items-center justify-center mb-4">
              <Image className="h-6 w-6 text-indigo-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">多様な形式に対応</h3>
            <p className="text-sm text-gray-600">
              PDF、JPG、PNG、GIF、WEBP、BMP、TIFFなど主要な画像形式に対応
            </p>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6">
            <div className="bg-green-100 rounded-lg p-3 w-12 h-12 flex items-center justify-center mb-4">
              <FileSpreadsheet className="h-6 w-6 text-green-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">レシート・帳票対応</h3>
            <p className="text-sm text-gray-600">
              請求書、レシート、名刺、帳票など様々な書類を正確に認識・抽出
            </p>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6">
            <div className="bg-purple-100 rounded-lg p-3 w-12 h-12 flex items-center justify-center mb-4">
              <FolderOpen className="h-6 w-6 text-purple-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">混在ファイルも一括処理</h3>
            <p className="text-sm text-gray-600">
              PDFと画像ファイルが混在したフォルダも一度に処理可能
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PdfImageBatchOcrToExcel;