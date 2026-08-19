import { useEffect } from "react";
import { Toaster, toast } from "@reactive-resume/ui/components/toast";

// Toaster is the toast host. Fire a persistent toast on mount so the card
// shows a real notification instead of an empty portal.
export const Notification = () => {
	useEffect(() => {
		toast.add({
			type: "success",
			title: "Resume published",
			description: "“Software Engineer” is now live at rxresume.me/jane-doe.",
			timeout: 0,
		});
	}, []);
	return (
		<div style={{ minHeight: 140 }}>
			<Toaster />
		</div>
	);
};
