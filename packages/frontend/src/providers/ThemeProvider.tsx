import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

// Font family options
export const FONT_FAMILIES = {
  system: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  inter: '"Inter", system-ui, sans-serif',
  roboto: '"Roboto", system-ui, sans-serif',
  'sf-pro': '"SF Pro Display", system-ui, sans-serif',
  'jetbrains-mono': '"JetBrains Mono", monospace',
  'fira-code': '"Fira Code", monospace',
} as const;

export type FontFamily = keyof typeof FONT_FAMILIES;
export type FontSize = '12' | '13' | '14' | '15' | '16' | '17' | '18' | '20';

interface ThemeSettings {
  desktop: {
    fontFamily: FontFamily;
    fontSize: FontSize;
  };
  mobile: {
    fontFamily: FontFamily;
    fontSize: FontSize;
  };
}

interface ThemeContextType {
  settings: ThemeSettings;
  updateDesktopFont: (fontFamily: FontFamily) => void;
  updateDesktopSize: (fontSize: FontSize) => void;
  updateMobileFont: (fontFamily: FontFamily) => void;
  updateMobileSize: (fontSize: FontSize) => void;
}

const defaultSettings: ThemeSettings = {
  desktop: {
    fontFamily: 'system',
    fontSize: '14',
  },
  mobile: {
    fontFamily: 'system',
    fontSize: '16',
  },
};

const ThemeContext = createContext<ThemeContextType | null>(null);

const STORAGE_KEY = 'theme-settings';

function loadSettings(): ThemeSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        desktop: { ...defaultSettings.desktop, ...parsed.desktop },
        mobile: { ...defaultSettings.mobile, ...parsed.mobile },
      };
    }
  } catch (e) {
    console.error('Failed to load theme settings:', e);
  }
  return defaultSettings;
}

function saveSettings(settings: ThemeSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save theme settings:', e);
  }
}

function applySettings(settings: ThemeSettings) {
  const root = document.documentElement;
  const isMobile = window.innerWidth < 768;

  const activeSettings = isMobile ? settings.mobile : settings.desktop;

  root.style.setProperty('--font-family', FONT_FAMILIES[activeSettings.fontFamily]);
  root.style.setProperty('--font-size', `${activeSettings.fontSize}px`);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ThemeSettings>(loadSettings);

  // Apply settings on mount and when they change
  useEffect(() => {
    applySettings(settings);
    saveSettings(settings);
  }, [settings]);

  // Re-apply on window resize (mobile/desktop switch)
  useEffect(() => {
    const handleResize = () => applySettings(settings);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [settings]);

  const updateDesktopFont = useCallback((fontFamily: FontFamily) => {
    setSettings(prev => ({
      ...prev,
      desktop: { ...prev.desktop, fontFamily },
    }));
  }, []);

  const updateDesktopSize = useCallback((fontSize: FontSize) => {
    setSettings(prev => ({
      ...prev,
      desktop: { ...prev.desktop, fontSize },
    }));
  }, []);

  const updateMobileFont = useCallback((fontFamily: FontFamily) => {
    setSettings(prev => ({
      ...prev,
      mobile: { ...prev.mobile, fontFamily },
    }));
  }, []);

  const updateMobileSize = useCallback((fontSize: FontSize) => {
    setSettings(prev => ({
      ...prev,
      mobile: { ...prev.mobile, fontSize },
    }));
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        settings,
        updateDesktopFont,
        updateDesktopSize,
        updateMobileFont,
        updateMobileSize,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
