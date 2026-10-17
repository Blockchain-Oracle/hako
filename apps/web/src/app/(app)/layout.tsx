/**
 * The app's route group (`/agent`, `/tools`, later `/settings` and `/activity`): the layer where the Kawase shell
 * (rail + stage, features/shell, Wave 1 L3) wraps every page. Until the shell lands it passes pages through unchanged.
 */
export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
