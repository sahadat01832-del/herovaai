import toast from 'react-hot-toast'

/**
 * High-Resolution Media Downloader
 * Supports 1K (Standard HD / Original) and 2K (Ultra HD - 2048px Upscaled).
 */
export async function downloadMedia(
  url: string,
  resolution: '1k' | '2k' = '1k',
  filenameLabel = 'herova_creation'
): Promise<boolean> {
  if (!url) {
    toast.error('No media URL provided')
    return false
  }

  const isVideo = /\.(mp4|webm|mov|mkv)(\?|$)/i.test(url)
  const cleanBase = filenameLabel.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30) || 'media'
  const timeSlug = Date.now().toString().slice(-6)
  const outName = `${cleanBase}_${resolution.toUpperCase()}_${timeSlug}`

  // Video download or 1K Image: Direct download
  if (isVideo || resolution === '1k') {
    const toastId = toast.loading(`Preparing ${isVideo ? 'video' : '1K HD image'} download...`)
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = `${outName}.${isVideo ? 'mp4' : 'jpg'}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
      toast.success(`${isVideo ? 'Video' : '1K HD image'} downloaded!`, { id: toastId })
      return true
    } catch {
      // Fallback: direct anchor trigger
      const a = document.createElement('a')
      a.href = url
      a.download = `${outName}.${isVideo ? 'mp4' : 'jpg'}`
      a.target = '_blank'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      toast.success('Download started in browser!', { id: toastId })
      return true
    }
  }

  // 2K Ultra HD Upscaling for images:
  const toastId = toast.loading('✨ Rendering 2K Ultra HD (2048px) image...')
  return new Promise<boolean>((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d', { alpha: false })
        if (!ctx) throw new Error('Canvas not supported')

        const nw = img.naturalWidth || 1024
        const nh = img.naturalHeight || 1024
        const isLandscape = nw >= nh
        const aspect = nw / nh

        // 2K standard: 2048px on the longest dimension
        const targetLongEdge = 2048
        const targetW = isLandscape ? targetLongEdge : Math.round(targetLongEdge * aspect)
        const targetH = isLandscape ? Math.round(targetLongEdge / aspect) : targetLongEdge

        canvas.width = targetW
        canvas.height = targetH

        // High fidelity bicubic smoothing
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, targetW, targetH)

        canvas.toBlob(
          (blob) => {
            if (!blob) throw new Error('Blob export failed')
            const blobUrl = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = blobUrl
            a.download = `${outName}_2K_UltraHD.jpg`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(blobUrl)
            toast.success('🚀 2K Ultra HD image downloaded!', { id: toastId })
            resolve(true)
          },
          'image/jpeg',
          0.96
        )
      } catch (err: any) {
        // Fallback to direct download
        const a = document.createElement('a')
        a.href = url
        a.download = `${outName}.jpg`
        a.target = '_blank'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        toast.success('Downloaded original high-res image!', { id: toastId })
        resolve(true)
      }
    }

    img.onerror = () => {
      // Fallback
      window.open(url, '_blank')
      toast.dismiss(toastId)
      resolve(false)
    }

    img.src = url
  })
}
