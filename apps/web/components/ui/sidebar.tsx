import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Separator } from '@/components/ui/separator';
import { Text, TextClassContext } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';
import { PanelLeftIcon, XIcon } from 'lucide-react-native';
import * as React from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type PressableProps,
  type ViewProps,
} from 'react-native';

const SIDEBAR_WIDTH = 256;
const SIDEBAR_STORAGE_KEY = 'sidebar_state';
const SIDEBAR_KEYBOARD_SHORTCUT = 'b';
const MOBILE_BREAKPOINT = 768;

/**
 * Minimal structural typings for web globals so this file typechecks without
 * requiring the DOM lib (the code paths are guarded by `Platform.OS === 'web'`).
 */
type WebKeyDownEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  preventDefault: () => void;
};

type WebGlobals = {
  localStorage?: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
  };
  document?: {
    addEventListener: (type: string, listener: (event: WebKeyDownEvent) => void) => void;
    removeEventListener: (type: string, listener: (event: WebKeyDownEvent) => void) => void;
  };
};

function readStoredSidebarState(): boolean | null {
  if (Platform.OS !== 'web') return null;
  try {
    const value = (globalThis as WebGlobals).localStorage?.getItem(SIDEBAR_STORAGE_KEY);
    return value == null ? null : value === 'true';
  } catch {
    return null;
  }
}

function persistSidebarState(open: boolean) {
  if (Platform.OS !== 'web') return;
  try {
    (globalThis as WebGlobals).localStorage?.setItem(SIDEBAR_STORAGE_KEY, String(open));
  } catch {
    // localStorage unavailable (private mode, SSR, etc.) - ignore.
  }
}

type SidebarContextValue = {
  state: 'expanded' | 'collapsed';
  open: boolean;
  setOpen: (open: boolean | ((open: boolean) => boolean)) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean | ((open: boolean) => boolean)) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider.');
  }
  return context;
}

type SidebarProviderProps = ViewProps & {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  className,
  children,
  ...props
}: SidebarProviderProps) {
  const { width } = useWindowDimensions();
  const isMobile = width > 0 && width < MOBILE_BREAKPOINT;

  const [openMobile, setOpenMobile] = React.useState(false);
  const [internalOpen, setInternalOpen] = React.useState<boolean>(
    () => readStoredSidebarState() ?? defaultOpen
  );
  const open = openProp ?? internalOpen;
  const openRef = React.useRef(open);
  openRef.current = open;

  const setOpen = React.useCallback(
    (value: boolean | ((open: boolean) => boolean)) => {
      const next = typeof value === 'function' ? value(openRef.current) : value;
      onOpenChange?.(next);
      if (openProp === undefined) {
        setInternalOpen(next);
      }
      persistSidebarState(next);
    },
    [onOpenChange, openProp]
  );

  const isMobileRef = React.useRef(isMobile);
  isMobileRef.current = isMobile;

  const toggleSidebar = React.useCallback(() => {
    if (isMobileRef.current) {
      setOpenMobile((current) => !current);
    } else {
      setOpen((current) => !current);
    }
  }, [setOpen]);

  // Close the mobile drawer when resizing up to desktop widths.
  React.useEffect(() => {
    if (!isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile]);

  // Cmd/Ctrl+B toggles the sidebar (web only).
  React.useEffect(() => {
    if (Platform.OS !== 'web') return;
    const doc = (globalThis as WebGlobals).document;
    if (!doc) return;
    const onKeyDown = (event: WebKeyDownEvent) => {
      if (event.key.toLowerCase() === SIDEBAR_KEYBOARD_SHORTCUT && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    doc.addEventListener('keydown', onKeyDown);
    return () => doc.removeEventListener('keydown', onKeyDown);
  }, [toggleSidebar]);

  const contextValue = React.useMemo<SidebarContextValue>(
    () => ({
      state: open ? 'expanded' : 'collapsed',
      open,
      setOpen,
      openMobile,
      setOpenMobile,
      isMobile,
      toggleSidebar,
    }),
    [open, setOpen, openMobile, isMobile, toggleSidebar]
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      <View
        className={cn('bg-background relative h-full w-full flex-1 flex-row', className)}
        {...props}>
        {children}
      </View>
    </SidebarContext.Provider>
  );
}

type SidebarProps = ViewProps & {
  side?: 'left' | 'right';
  collapsible?: 'offcanvas' | 'none';
};

function Sidebar({ side = 'left', collapsible = 'offcanvas', className, children, ...props }: SidebarProps) {
  const { isMobile } = useSidebar();

  if (collapsible === 'none') {
    return (
      <View
        style={{ width: SIDEBAR_WIDTH }}
        className={cn(
          'bg-sidebar border-sidebar-border h-full flex-col',
          side === 'left' ? 'border-r' : 'border-l',
          className
        )}
        {...props}>
        <TextClassContext.Provider value="text-sidebar-foreground">
          {children}
        </TextClassContext.Provider>
      </View>
    );
  }

  if (isMobile) {
    return (
      <MobileSidebar side={side} className={className} {...props}>
        {children}
      </MobileSidebar>
    );
  }

  return (
    <DesktopSidebar side={side} className={className} {...props}>
      {children}
    </DesktopSidebar>
  );
}

function DesktopSidebar({ side = 'left', className, children, ...props }: SidebarProps) {
  const { open } = useSidebar();
  const widthAnim = React.useRef(new Animated.Value(open ? SIDEBAR_WIDTH : 0)).current;

  React.useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: open ? SIDEBAR_WIDTH : 0,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [open, widthAnim]);

  return (
    <Animated.View style={{ width: widthAnim, overflow: 'hidden', height: '100%' }}>
      {/* Inner panel keeps a fixed width and is anchored to the closing edge so the
          content slides offcanvas instead of squishing while the width animates. */}
      <View
        style={[
          { width: SIDEBAR_WIDTH, position: 'absolute', top: 0, bottom: 0 },
          side === 'left' ? { right: 0 } : { left: 0 },
        ]}
        className={cn(
          'bg-sidebar border-sidebar-border flex-col',
          side === 'left' ? 'border-r' : 'border-l',
          className
        )}
        {...props}>
        <TextClassContext.Provider value="text-sidebar-foreground">
          {children}
        </TextClassContext.Provider>
      </View>
    </Animated.View>
  );
}

function MobileSidebar({ side = 'left', className, children, ...props }: SidebarProps) {
  const { openMobile, setOpenMobile } = useSidebar();
  const { width: screenWidth } = useWindowDimensions();
  const [visible, setVisible] = React.useState(openMobile);
  const progress = React.useRef(new Animated.Value(openMobile ? 1 : 0)).current;

  React.useEffect(() => {
    if (openMobile) {
      setVisible(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: 250,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    } else {
      Animated.timing(progress, {
        toValue: 0,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) {
          setVisible(false);
        }
      });
    }
  }, [openMobile, progress]);

  if (!visible) {
    return null;
  }

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: side === 'left' ? [-screenWidth, 0] : [screenWidth, 0],
  });

  return (
    <View
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 }}
      pointerEvents="box-none">
      {/* Backdrop */}
      <Animated.View
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: progress }}>
        <Pressable
          onPress={() => setOpenMobile(false)}
          accessibilityLabel="Close sidebar"
          className="h-full w-full bg-black/50"
        />
      </Animated.View>
      {/* Full-screen sliding panel */}
      <Animated.View
        style={[
          { position: 'absolute', top: 0, bottom: 0, width: screenWidth, transform: [{ translateX }] },
          side === 'left' ? { left: 0 } : { right: 0 },
        ]}>
        <View className={cn('bg-sidebar h-full w-full flex-col', className)} {...props}>
          <TextClassContext.Provider value="text-sidebar-foreground">
            {children}
          </TextClassContext.Provider>
          <Pressable
            onPress={() => setOpenMobile(false)}
            accessibilityLabel="Close sidebar"
            className="active:bg-sidebar-accent absolute right-3 top-3 h-8 w-8 items-center justify-center rounded-md">
            <Icon as={XIcon} className="text-sidebar-foreground size-4" />
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

function SidebarTrigger({ className, onPress, ...props }: PressableProps & { className?: string }) {
  const { toggleSidebar } = useSidebar();

  return (
    <Button
      variant="ghost"
      size="icon"
      accessibilityLabel="Toggle sidebar"
      className={cn('h-8 w-8', className)}
      onPress={(event: GestureResponderEvent) => {
        if (typeof onPress === 'function') {
          onPress(event);
        }
        toggleSidebar();
      }}
      {...props}>
      <Icon as={PanelLeftIcon} className="size-4" />
    </Button>
  );
}

function SidebarInset({ className, ...props }: ViewProps) {
  return <View className={cn('bg-background relative min-w-0 flex-1 flex-col', className)} {...props} />;
}

function SidebarHeader({ className, ...props }: ViewProps) {
  return <View className={cn('flex-col gap-2 p-2', className)} {...props} />;
}

function SidebarFooter({ className, ...props }: ViewProps) {
  return <View className={cn('flex-col gap-2 p-2', className)} {...props} />;
}

function SidebarContent({
  className,
  contentContainerClassName,
  ...props
}: React.ComponentProps<typeof ScrollView> & { contentContainerClassName?: string }) {
  return (
    <ScrollView
      className={cn('min-h-0 flex-1', className)}
      contentContainerClassName={cn('flex-col gap-2', contentContainerClassName)}
      showsVerticalScrollIndicator={false}
      {...props}
    />
  );
}

function SidebarGroup({ className, ...props }: ViewProps) {
  return <View className={cn('relative w-full min-w-0 flex-col p-2', className)} {...props} />;
}

function SidebarGroupLabel({ className, children, ...props }: ViewProps) {
  return (
    <View className={cn('h-8 shrink-0 flex-row items-center rounded-md px-2', className)} {...props}>
      {typeof children === 'string' ? (
        <Text className="text-sidebar-foreground/70 text-xs font-medium">{children}</Text>
      ) : (
        children
      )}
    </View>
  );
}

function SidebarGroupContent({ className, ...props }: ViewProps) {
  return <View className={cn('w-full flex-col', className)} {...props} />;
}

function SidebarMenu({ className, ...props }: ViewProps) {
  return <View className={cn('w-full min-w-0 flex-col gap-1', className)} {...props} />;
}

function SidebarMenuItem({ className, ...props }: ViewProps) {
  return <View className={cn('relative w-full', className)} {...props} />;
}

const sidebarMenuButtonVariants = cva(
  cn(
    'active:bg-sidebar-accent w-full min-w-0 flex-row items-center gap-2 overflow-hidden rounded-md p-2',
    Platform.select({
      web: 'hover:bg-sidebar-accent focus-visible:ring-sidebar-ring outline-none transition-colors focus-visible:ring-2 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0',
    })
  ),
  {
    variants: {
      size: {
        default: 'h-8',
        sm: 'h-7',
        lg: 'h-12',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
);

type SidebarMenuButtonProps = PressableProps &
  VariantProps<typeof sidebarMenuButtonVariants> & {
    className?: string;
    isActive?: boolean;
  };

function SidebarMenuButton({ className, isActive = false, size, ...props }: SidebarMenuButtonProps) {
  return (
    <TextClassContext.Provider
      value={cn(
        'text-sidebar-foreground text-sm',
        isActive && 'text-sidebar-accent-foreground font-medium'
      )}>
      <Pressable
        role="button"
        accessibilityState={{ selected: isActive }}
        className={cn(
          sidebarMenuButtonVariants({ size }),
          isActive && 'bg-sidebar-accent',
          props.disabled && 'opacity-50',
          className
        )}
        {...props}
      />
    </TextClassContext.Provider>
  );
}

function SidebarMenuBadge({ className, children, ...props }: ViewProps) {
  return (
    <View
      className={cn(
        'pointer-events-none absolute right-1 top-1.5 h-5 min-w-5 flex-row items-center justify-center rounded-md px-1',
        className
      )}
      {...props}>
      {typeof children === 'string' || typeof children === 'number' ? (
        <Text className="text-sidebar-foreground text-xs font-medium tabular-nums">{children}</Text>
      ) : (
        children
      )}
    </View>
  );
}

function SidebarSeparator({ className, ...props }: React.ComponentProps<typeof Separator>) {
  return <Separator className={cn('bg-sidebar-border mx-2 w-auto', className)} {...props} />;
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
};
