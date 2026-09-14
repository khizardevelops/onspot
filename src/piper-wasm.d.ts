declare module '@diffusionstudio/piper-wasm' {
	type PiperModule = {
		callMain(args: string[]): number;
	};

	type PiperFactory = (options: {
		print?: (line: string) => void;
		printErr?: (message: string) => void;
		locateFile?: (url: string) => string;
	}) => Promise<PiperModule>;

	const createPiperPhonemize: PiperFactory;
	export default createPiperPhonemize;
}
