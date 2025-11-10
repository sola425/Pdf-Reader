import React, { useState, useEffect, useRef } from 'react';

interface ThumbnailProps {
    pdfDoc: any;
    pageNum: number;
    cachedThumb: string | null;
    onThumbGenerated: (pageNum: number, dataUrl: string) => void;
    onClick: () => void;
    isActive: boolean;
}

const MemoizedThumbnail = React.memo(({ pdfDoc, pageNum, cachedThumb, onThumbGenerated, onClick, isActive }: ThumbnailProps) => {
    const [isLoading, setIsLoading] = useState(!cachedThumb);
    const thumbRef = useRef<HTMLDivElement>(null);
    const [isIntersecting, setIsIntersecting] = useState(false);

    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setIsIntersecting(true);
                    observer.disconnect(); // Observe only once
                }
            },
            { rootMargin: '200px 0px 200px 0px' } // Pre-load thumbnails slightly outside the viewport
        );

        const currentRef = thumbRef.current;
        if (currentRef) {
            observer.observe(currentRef);
        }

        return () => {
            if (currentRef) {
                observer.unobserve(currentRef);
            }
        };
    }, []);

    useEffect(() => {
        let isMounted = true;
        if (isIntersecting && !cachedThumb) {
            const generate = async () => {
                if (!isMounted) return;
                setIsLoading(true);
                try {
                    const page = await pdfDoc.getPage(pageNum);
                    const THUMBNAIL_WIDTH = 120;
                    const viewport = page.getViewport({ scale: 1 });
                    const scale = THUMBNAIL_WIDTH / viewport.width;
                    const thumbViewport = page.getViewport({ scale });
                    
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = thumbViewport.width;
                    tempCanvas.height = thumbViewport.height;
                    const canvasContext = tempCanvas.getContext('2d')!;
                    
                    await page.render({ canvasContext, viewport: thumbViewport }).promise;
                    if (isMounted) {
                        onThumbGenerated(pageNum, tempCanvas.toDataURL());
                    }
                } catch (e) {
                    console.error(`Failed to generate thumbnail for page ${pageNum}`, e);
                } finally {
                    if (isMounted) {
                        setIsLoading(false);
                    }
                }
            };
            generate();
        } else if (cachedThumb) {
            setIsLoading(false);
        }

        return () => {
            isMounted = false;
        }
    }, [pdfDoc, pageNum, cachedThumb, onThumbGenerated, isIntersecting]);

    return (
        <div 
            ref={thumbRef}
            onClick={onClick} 
            className={`cursor-pointer border-2 p-1 ${isActive ? 'border-blue-500' : 'border-transparent'} rounded-md hover:border-blue-400 bg-white`}
            role="button" tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
        >
            <div className="relative w-full aspect-[2/3] bg-slate-200 rounded-sm shadow-md">
                {(isLoading || !cachedThumb) ? (
                    <div className="w-full h-full flex items-center justify-center">
                        <div className="w-6 h-6 border-2 border-t-blue-500 border-slate-300 rounded-full animate-spin"></div>
                    </div>
                ) : (
                    <img src={cachedThumb} alt={`Page ${pageNum}`} className="w-full h-full object-contain" />
                )}
            </div>
            <p className="text-center text-xs font-semibold text-slate-700 mt-1">{pageNum}</p>
        </div>
    );
});

export { MemoizedThumbnail as Thumbnail };