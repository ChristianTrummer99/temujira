import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view';
import { cn } from '@/lib/utils';
import * as DialogPrimitive from '@rn-primitives/dialog';
import * as React from 'react';
import { Platform, type GestureResponderEvent } from 'react-native';
import {
  FadeIn,
  FadeOut,
  ReduceMotion,
  SlideInRight,
  SlideOutRight,
} from 'react-native-reanimated';
import { FullWindowOverlay as RNFullWindowOverlay } from 'react-native-screens';

const Sheet = DialogPrimitive.Root;

const SheetPortal = DialogPrimitive.Portal;

const SheetTrigger = DialogPrimitive.Trigger;

const SheetClose = DialogPrimitive.Close;

const FullWindowOverlay = Platform.OS === 'ios' ? RNFullWindowOverlay : React.Fragment;

/**
 * Wraps nested RN context through native-screen overlays (iOS) so portal content — the
 * tray panels in this app — survives keyboard views and window-depth sorting.
 */
function SheetOverlay({ className }: { className?: string }) {
  const { onOpenChange } = DialogPrimitive.useRootContext();

  function onOverlayPress(event: GestureResponderEvent) {
    // Only a press on the backdrop itself (not bubbled from the panel) closes the sheet.
    if (event.target === event.currentTarget && !event.isDefaultPrevented()) {
      onOpenChange(false);
    }
  }

  return (
    <FullWindowOverlay>
      <DialogPrimitive.Overlay
        className={cn(
          'absolute bottom-0 left-0 right-0 top-0 z-50 bg-black/30',
          Platform.select({
            web: 'animate-in fade-in-0 fixed cursor-default [&>*]:cursor-auto',
          }),
          className
        )}
        onPress={Platform.select({ web: onOverlayPress, native: onOverlayPress })}
        asChild={Platform.OS !== 'web'}>
        <NativeOnlyAnimatedView
          entering={FadeIn.duration(200).reduceMotion(ReduceMotion.System)}
          exiting={FadeOut.duration(150).reduceMotion(ReduceMotion.System)}
          as="Pressable"
        />
      </DialogPrimitive.Overlay>
    </FullWindowOverlay>
  );
}

function SheetContent({
  className,
  portalHost,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  portalHost?: string;
}) {
  const { open } = DialogPrimitive.useRootContext();

  // Prevent the page behind a tall tray from scrolling/panning (web). Radix already
  // traps focus; this keeps wheel/touch from reaching the list underneath.
  React.useEffect(() => {
    if (Platform.OS !== 'web' || !open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <SheetPortal hostName={portalHost}>
      <SheetOverlay />
      <DialogPrimitive.Content
        className={cn(
          'border-border bg-background fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-hidden border-l shadow-lg shadow-black/5',
          Platform.select({
            web: 'animate-in slide-in-from-right duration-300',
          }),
          className
        )}
        {...props}>
        <NativeOnlyAnimatedView
          entering={SlideInRight.duration(250).reduceMotion(ReduceMotion.System)}
          exiting={SlideOutRight.duration(200).reduceMotion(ReduceMotion.System)}
          className="flex-1">
          <>{children}</>
        </NativeOnlyAnimatedView>
      </DialogPrimitive.Content>
    </SheetPortal>
  );
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-foreground text-lg font-semibold leading-none', className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};