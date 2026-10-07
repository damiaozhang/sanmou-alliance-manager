# -*- coding: utf-8 -*-
"""
Frida client module - Process detection, injection, event stream management
with exponential backoff reconnect, heartbeat, and circuit breaker
"""
import frida
import os
import sys
import time
import json
import threading
from typing import Optional, Callable, List
from logging import getLogger

logger = getLogger(__name__)

class FridaClient:
    """Manages Frida session with process detection, injection, and event streaming"""
    
    def __init__(self, config: dict, diagnostic: bool = False):
        self.config = config
        self.game_processes = config.get("game_process", [])
        self.fuzzy_pattern = config.get("game_process_fuzzy", "nslg")
        self.diagnostic = diagnostic
        
        if getattr(sys, 'frozen', False):
            data_dir = sys._MEIPASS
        else:
            data_dir = os.path.dirname(os.path.abspath(__file__))
            
        if diagnostic:
            self.hook_script_path = os.path.join(data_dir, "frida_hook_diagnostic.js")
        else:
            self.hook_script_path = os.path.join(data_dir, "frida_hook.js")
        
        self.device = None
        self.session = None
        self.script = None
        self.target_process = None
        
        self.on_event = None
        self.on_error = None
        self.on_info = None
        self.on_ready = None
        self.on_disconnected = None
        self.on_alliance_list = None
        self.on_raw_dump = None
        
        self._running = False
        self._lock = threading.Lock()
        self._reconnect_timer = None
        self._reconnect_attempts = 0
        
        rc_cfg = config.get("reconnect", {})
        self._max_retries = rc_cfg.get("max_retries", 5)
        self._base_delay = rc_cfg.get("base_delay_sec", 3)
        self._max_delay = rc_cfg.get("max_delay_sec", 60)
        
        hb_cfg = config.get("heartbeat", {})
        self._heartbeat_interval = hb_cfg.get("interval_sec", 30)
        self._heartbeat_timeout = hb_cfg.get("timeout_sec", 5)
        self._last_message_time = 0
        self._heartbeat_timer = None
        
        cb_cfg = config.get("circuit_breaker", {})
        self._error_threshold = cb_cfg.get("error_threshold", 10)
        self._cooldown_sec = cb_cfg.get("cooldown_sec", 10)
        self._consecutive_errors = 0
        self._cooldown_until = 0
        
    def find_process(self) -> Optional[object]:
        """Find game process with priority-based matching"""
        if time.time() < self._cooldown_until:
            if self.on_info:
                remaining = int(self._cooldown_until - time.time())
                self.on_info(f"熔断冷却中，{remaining}s 后重试...")
            return None
            
        try:
            self.device = frida.get_local_device()
        except Exception as e:
            logger.error(f"Frida device connection failed: {e}")
            if self.on_error:
                self.on_error(f"Frida连接失败: {e}")
            return None
            
        try:
            procs = self.device.enumerate_processes()
        except Exception as e:
            logger.error(f"Process enumeration failed: {e}")
            if self.on_error:
                self.on_error(f"枚举进程失败: {e}")
            return None
            
        for name in self.game_processes:
            for p in procs:
                if p.name == name:
                    logger.info(f"Found exact match: {p.name} (PID: {p.pid})")
                    return p
                    
        for p in procs:
            if self.fuzzy_pattern.lower() in p.name.lower():
                logger.info(f"Found fuzzy match: {p.name} (PID: {p.pid})")
                return p
                
        return None
        
    def inject(self, process: object) -> bool:
        """Inject Frida script into target process"""
        if not os.path.exists(self.hook_script_path):
            msg = f"Hook script not found: {self.hook_script_path}"
            logger.error(msg)
            if self.on_error:
                self.on_error(msg)
            return False
            
        with open(self.hook_script_path, "r", encoding="utf-8") as f:
            js_code = f.read()
            
        try:
            self.session = self.device.attach(process.pid)
        except Exception as e:
            msg = f"Process attach failed: {e}"
            logger.error(msg)
            if self.on_error:
                self.on_error(msg)
            return False
            
        self.session.on("detached", self._on_session_detached)
            
        try:
            self.script = self.session.create_script(js_code)
            self.script.on("message", self._on_message)
            self.script.load()
            self.target_process = process
            self._last_message_time = time.time()
            self._reconnect_attempts = 0
            self._consecutive_errors = 0
            logger.info(f"Successfully injected into {process.name} (PID: {process.pid})")
            return True
        except Exception as e:
            msg = f"Script injection failed: {e}"
            logger.error(msg)
            if self.on_error:
                self.on_error(msg)
            self.session.detach()
            self.session = None
            return False
            
    def _on_session_detached(self, reason, crash):
        """Handle session detachment"""
        msg = f"Session detached: {reason}"
        logger.error(msg)
        
        if self.on_error:
            self.on_error(msg)
            
        self._running = False
        self.session = None
        self.script = None
        
        self._stop_heartbeat()
        
        if self.on_disconnected:
            self.on_disconnected()
        
        if reason == "application-requested" and self.on_info:
            self.on_info("游戏进程已断开，正在尝试重新连接...")
            self._schedule_reconnect()
            
    def _calc_backoff_delay(self) -> float:
        """Exponential backoff: 3s -> 6s -> 12s -> 30s -> 60s, capped at max_delay"""
        delay = self._base_delay * (2 ** self._reconnect_attempts)
        return min(delay, self._max_delay)
            
    def _schedule_reconnect(self):
        """Schedule reconnection attempt with exponential backoff"""
        if self._reconnect_timer:
            self._reconnect_timer.cancel()
        
        self._reconnect_attempts += 1
        
        if self._reconnect_attempts > self._max_retries:
            logger.warning(f"Max reconnection attempts ({self._max_retries}) reached")
            if self.on_info:
                self.on_info(f"已尝试 {self._max_retries} 次重连失败，请手动点击'开始监听'")
            self._reconnect_attempts = 0
            return
        
        delay = self._calc_backoff_delay()
        logger.info(f"Reconnecting in {delay:.0f}s (attempt {self._reconnect_attempts}/{self._max_retries})")
        
        if self.on_info:
            self.on_info(f"{delay:.0f}s 后进行第 {self._reconnect_attempts} 次重连...")
        
        def try_reconnect():
            if self._running:
                process = self.find_process()
                if process and self.inject(process):
                    self._running = True
                    self._start_heartbeat()
                    if self.on_info:
                        self.on_info("重新连接成功！")
                else:
                    self._schedule_reconnect()
        
        self._reconnect_timer = threading.Timer(delay, try_reconnect)
        self._reconnect_timer.daemon = True
        self._reconnect_timer.start()
            
    def _on_message(self, msg, data):
        """Handle messages from Frida script"""
        self._last_message_time = time.time()
        
        try:
            msg_type = msg.get("type", "")
            
            if msg_type != "send":
                if msg_type == "error":
                    self._consecutive_errors += 1
                    if self._consecutive_errors >= self._error_threshold:
                        self._activate_circuit_breaker()
                    if self.on_error:
                        self.on_error(f"Frida error: {msg.get('description', '')}")
                return
                
            self._consecutive_errors = 0
            
            payload = msg.get("payload", {})
            if not isinstance(payload, dict):
                return
                
            inner_type = payload.get("type", "")
            inner_payload = payload.get("payload", {})
            
            if inner_type == "batch":
                events = inner_payload.get("events", []) if isinstance(inner_payload, dict) else []
                if self.on_event:
                    for evt in events:
                        self.on_event(evt)
            elif inner_type == "list_data":
                events = inner_payload.get("events", []) if isinstance(inner_payload, dict) else []
                if self.on_list_data:
                    for evt in events:
                        self.on_list_data(evt)
            elif inner_type == "dump_data":
                events = inner_payload.get("events", []) if isinstance(inner_payload, dict) else []
                if self.on_dump_data:
                    for evt in events:
                        self.on_dump_data(evt)
            elif inner_type == "alliance_battle_list":
                records = inner_payload.get("records", []) if isinstance(inner_payload, dict) else []
                if self.on_alliance_list:
                    self.on_alliance_list(records)
            elif inner_type == "alliance_raw":
                if isinstance(inner_payload, dict):
                    entries = inner_payload.get("entries", [])
                    structured = inner_payload.get("structured", {})
                else:
                    entries = []
                    structured = {}
                if self.on_raw_dump:
                    self.on_raw_dump(entries, structured)
            elif inner_type == "raw_dump":
                events = inner_payload.get("events", []) if isinstance(inner_payload, dict) else []
                if self.on_raw_dump:
                    self.on_raw_dump(events)
            elif inner_type == "error":
                self._consecutive_errors += 1
                if self._consecutive_errors >= self._error_threshold:
                    self._activate_circuit_breaker()
                if self.on_error:
                    err_msg = inner_payload.get("msg", "Unknown error") if isinstance(inner_payload, dict) else str(inner_payload)
                    self.on_error(err_msg)
            elif inner_type == "ready":
                self._consecutive_errors = 0
                if self.on_ready:
                    ready_msg = inner_payload.get("msg", "") if isinstance(inner_payload, dict) else str(inner_payload)
                    self.on_ready(ready_msg)
            elif inner_type == "info":
                if self.on_info:
                    info_msg = inner_payload.get("msg", "") if isinstance(inner_payload, dict) else str(inner_payload)
                    self.on_info(info_msg)
        except Exception as e:
            logger.error(f"Message handler error: {e}")
            
    def _activate_circuit_breaker(self):
        """Activate circuit breaker on error threshold exceeded"""
        self._cooldown_until = time.time() + self._cooldown_sec
        logger.warning(f"Circuit breaker activated for {self._cooldown_sec}s (errors: {self._consecutive_errors})")
        if self.on_info:
            self.on_info(f"连续 {self._consecutive_errors} 次错误，暂停 {self._cooldown_sec}s")
        self.stop()
        
    def _start_heartbeat(self):
        """Start heartbeat monitor to detect silent disconnects"""
        self._stop_heartbeat()
        self._last_message_time = time.time()
        
        def check_heartbeat():
            if not self._running:
                return
            idle_time = time.time() - self._last_message_time
            timeout = self._heartbeat_interval + self._heartbeat_timeout
            if idle_time > timeout:
                logger.warning(f"Heartbeat lost: no messages for {idle_time:.0f}s")
                if self.on_info:
                    self.on_info(f"心跳超时 ({idle_time:.0f}s 无消息)，可能已断开")
                self._running = False
                self.stop()
                if self.on_disconnected:
                    self.on_disconnected()
            else:
                self._heartbeat_timer = threading.Timer(self._heartbeat_interval, check_heartbeat)
                self._heartbeat_timer.daemon = True
                self._heartbeat_timer.start()
        
        self._heartbeat_timer = threading.Timer(self._heartbeat_interval, check_heartbeat)
        self._heartbeat_timer.daemon = True
        self._heartbeat_timer.start()
        
    def _stop_heartbeat(self):
        """Stop heartbeat monitor"""
        if self._heartbeat_timer:
            self._heartbeat_timer.cancel()
            self._heartbeat_timer = None
                
    def start(self) -> bool:
        """Find process and inject script"""
        if self._reconnect_timer:
            self._reconnect_timer.cancel()
            self._reconnect_timer = None
            
        self.stop()
        
        process = self.find_process()
        if not process:
            msg = f"未找到游戏进程 ({', '.join(self.game_processes)})"
            logger.error(msg)
            if self.on_error:
                self.on_error(msg)
            return False
            
        if not self.inject(process):
            return False
            
        self._running = True
        self._start_heartbeat()
        return True
        
    def stop(self):
        """Stop Frida session"""
        self._running = False
        self._stop_heartbeat()
        
        if self._reconnect_timer:
            self._reconnect_timer.cancel()
            self._reconnect_timer = None
            
        if self.script:
            try:
                self.script.unload()
            except:
                pass
            self.script = None
        if self.session:
            try:
                self.session.detach()
            except:
                pass
            self.session = None
            
    def is_running(self) -> bool:
        return self._running and self.session is not None
