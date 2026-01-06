import { Image } from 'lucide-react';
import { Card } from '@/components/ui/card';

interface GeneratedImageProps {
  image: {
    timestamp: number;
    imageBase64?: string;
    mimeType: string;
    prompt: string;
  };
  index: number;
}

export function GeneratedImage({ image, index }: GeneratedImageProps) {
  return (
    <div key={`gen-img-${image.timestamp}-${index}`} className="flex justify-start animate-fade-in w-full">
      <Card className="p-2 md:p-3 bg-gradient-to-br from-purple-500/10 to-blue-500/10 border-purple-500/30">
        <div className="flex items-center gap-2 mb-3">
          <div className="p-1.5 rounded-full bg-purple-500/20">
            <Image className="h-4 w-4 text-purple-500" />
          </div>
          <span className="text-sm font-medium text-purple-600 dark:text-purple-400">
            Generated Image (Gemini)
          </span>
        </div>
        {image.imageBase64 && (
          <img
            src={`data:${image.mimeType};base64,${image.imageBase64}`}
            alt={image.prompt}
            className="max-w-full rounded-lg border border-purple-500/20 cursor-pointer hover:opacity-90 transition-opacity mb-3"
            onClick={() => {
              const link = document.createElement('a');
              link.href = `data:${image.mimeType};base64,${image.imageBase64}`;
              link.download = `gemini-image-${image.timestamp}.png`;
              link.click();
            }}
          />
        )}
        <p className="text-xs text-muted-foreground italic">"{image.prompt}"</p>
      </Card>
    </div>
  );
}