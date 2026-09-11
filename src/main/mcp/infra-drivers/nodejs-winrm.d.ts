// @netcuras/nodejs-winrm ships no type declarations. Minimal ambient shim
// covering only the surface this codebase actually calls.
declare module '@netcuras/nodejs-winrm' {
  interface WinrmClient {
    runCommand: (
      command: string,
      host: string,
      username: string,
      password: string,
      port: number,
      usePowershell?: boolean
    ) => Promise<string | Error>;

    runPowershell: (
      command: string,
      host: string,
      username: string,
      password: string,
      port: number
    ) => Promise<string | Error>;
  }

  const winrm: WinrmClient;
  export default winrm;
}
